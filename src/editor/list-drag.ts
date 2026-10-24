// Moving list items by dragging (§8): a grip before each bullet starts a
// pointer drag. Up and down picks the place in the item's own list, left and
// right how deep it nests there; the item moves with its children.

import { Range, RangeSetBuilder, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import { docLines, lineChanges } from "../org/edit";
import { DropSlot, dropSlots, itemExtent, listDepths, moveItem, parseItem } from "../org/lists";
import { orgHost, structureOf } from "./state";

/** Lines [from, to) (0-based) being dragged, dimmed while the drag lasts. */
const setDragged = StateEffect.define<{ from: number; to: number } | null>();

const draggedLine = Decoration.line({ class: "org-list-dragged" });

const draggedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setDragged)) continue;
      if (!e.value) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      for (let n = e.value.from; n < e.value.to; n++) builder.add(tr.state.doc.line(n + 1).from, tr.state.doc.line(n + 1).from, draggedLine);
      return builder.finish();
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The left edge of a line's text, in client coordinates. */
function textLeft(view: EditorView, n: number): number {
  const { node } = view.domAtPos(view.state.doc.line(n + 1).from);
  const line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
  if (!line) return view.contentDOM.getBoundingClientRect().left;
  // the hanging indent (CHK-14) is a border with the same negative text-indent
  const style = getComputedStyle(line);
  return line.getBoundingClientRect().left + (parseFloat(style.borderLeftWidth) || 0) +
    (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.textIndent) || 0);
}

/** CHK-13: the extra indent of one nesting level, in pixels, as the stylesheet sets it. */
function nestingStep(view: EditorView): number {
  const probe = view.dom.appendChild(document.createElement("div"));
  probe.className = "org-list-step-probe";
  const px = parseFloat(getComputedStyle(probe).marginLeft) || 0;
  probe.remove();
  return px;
}

function isHidden(view: EditorView, n: number): boolean {
  if (n >= view.state.doc.lines) return false;
  const pos = view.state.doc.line(n + 1).from;
  let hidden = false;
  foldedRanges(view.state).between(pos, pos, (from, to) => {
    if (from < pos && to >= pos) hidden = true;
  });
  return hidden;
}

export interface DropTarget {
  slot: DropSlot;
  /** the slot's place, in document coordinates; the item's own slot spans its lines */
  top: number;
  bottom: number;
}

/**
 * CHK-11: the target nearest to height `y` (the item's own slot covers all of
 * its lines, so it stays put while the pointer is over it), and the level
 * `shift` steps right (or left, when negative) of the one nearest the item's
 * own indentation, kept within the levels allowed there.
 */
export function chooseDrop(targets: DropTarget[], y: number, ownIndent: number, shift: number): { slot: DropSlot; indent: number; depth: number; top: number } | null {
  let best: DropTarget | null = null;
  let distance = Infinity;
  for (const t of targets) {
    const d = y < t.top ? t.top - y : y > t.bottom ? y - t.bottom : 0;
    if (d < distance) [best, distance] = [t, d];
  }
  if (!best) return null;
  const levels = best.slot.indents;
  let base = 0;
  levels.forEach((indent, i) => {
    if (Math.abs(indent - ownIndent) < Math.abs(levels[base] - ownIndent)) base = i;
  });
  const i = Math.max(0, Math.min(levels.length - 1, base + shift));
  return { slot: best.slot, indent: levels[i], depth: best.slot.minDepth + i, top: best.top };
}

/** CHK-11: how far sideways one level is: a finger's width on touch, two characters with a mouse. */
const TOUCH_STEP = 32;

class Drag {
  private lines: string[];
  private slots: DropSlot[];
  private indent: number;
  private left: number;
  private gripWidth: number;
  private marker: HTMLElement;
  private ghost: HTMLElement;
  private choice: { slot: DropSlot; indent: number } | null = null;
  private x = 0;
  private y = 0;
  private startX: number;
  private timer: number | null = null;
  private doc: Text;
  private step: number;
  private nesting: number;

  constructor(private view: EditorView, private n: number, grip: HTMLElement, x: number, private touch: boolean) {
    this.doc = view.state.doc;
    this.lines = docLines(view.state.doc);
    this.slots = dropSlots(this.lines, n).filter((s) => !isHidden(view, s.line));
    this.indent = parseItem(this.lines[n])!.indent;
    // where the text of a top-level line starts: this line's left, less its extra indent
    this.nesting = nestingStep(view);
    this.left = textLeft(view, n) - Math.max(0, listDepths(this.lines)[n]) * this.nesting;
    this.gripWidth = grip.getBoundingClientRect().width;
    this.startX = this.x = x;
    this.step = touch ? TOUCH_STEP : 2 * (view.defaultCharacterWidth || 8);
    this.marker = view.dom.appendChild(document.createElement("div"));
    this.marker.className = "org-list-drop is-hidden";
    this.ghost = view.dom.appendChild(document.createElement("div"));
    this.ghost.className = "org-list-ghost is-hidden";
    this.ghost.textContent = this.lines[n].slice(parseItem(this.lines[n])!.textFrom).trim() || this.lines[n].trim();
    view.dom.classList.add("org-list-dragging");
    view.dispatch({ effects: setDragged.of({ from: n, to: itemExtent(this.lines, n) }) });
  }

  /** CHK-11: the nearest slot by height, and the indentation nearest to where the pointer has moved sideways. */
  move(x: number, y: number) {
    this.x = x;
    this.y = y;
    const view = this.view;
    const docY = y - view.documentTop;
    const charWidth = view.defaultCharacterWidth || 8;
    const doc = view.state.doc;
    const end = itemExtent(this.lines, this.n);
    const topOf = (line: number) => (line >= doc.lines ? view.lineBlockAt(doc.length).bottom : view.lineBlockAt(doc.line(line + 1).from).top);
    const targets = this.slots.map((slot) => {
      if (slot.original) return { slot, top: topOf(this.n), bottom: topOf(end) };
      const top = topOf(slot.line);
      return { slot, top, bottom: top };
    });
    const choice = chooseDrop(targets, docY, this.indent, Math.round((x - this.startX) / this.step));
    if (!choice) return;
    const { indent, depth } = choice;
    this.choice = choice;
    const editor = view.dom.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const left = this.left + this.gripWidth + indent * charWidth + depth * this.nesting - editor.left;
    const top = choice.top + view.documentTop - editor.top;
    const noop = choice.slot.original && indent === this.indent;
    this.marker.classList.toggle("is-hidden", noop);
    this.marker.style.top = `${top - 1}px`;
    this.marker.style.left = `${left}px`;
    this.marker.style.width = `${Math.max(content.right - editor.left - left, 24)}px`;
    this.ghost.classList.remove("is-hidden");
    // above the finger, which would hide it
    this.ghost.style.top = `${y - editor.top - (this.touch ? 64 : 14)}px`;
    this.ghost.style.left = `${left}px`;
    this.scrollNearEdges();
  }

  private speed(): number {
    const rect = this.view.scrollDOM.getBoundingClientRect();
    if (this.y < rect.top + 48) return -12;
    if (this.y > rect.bottom - 48) return 12;
    return 0;
  }

  private scrollNearEdges() {
    if (!this.speed()) return this.stopScrolling();
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      if (!this.speed()) return this.stopScrolling();
      this.view.scrollDOM.scrollTop += this.speed();
      this.view.requestMeasure({ read: () => null, write: () => this.move(this.x, this.y) });
    }, 30);
  }

  private stopScrolling() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  finish(drop: boolean) {
    this.stopScrolling();
    this.marker.remove();
    this.ghost.remove();
    const view = this.view;
    view.dom.classList.remove("org-list-dragging");
    const effects = setDragged.of(null);
    // the file changed under the drag (a sync): drop nothing
    const after = drop && this.choice && view.state.doc === this.doc ? moveItem(this.lines, this.n, this.choice.slot, this.choice.indent) : null;
    view.dispatch(after
      ? { changes: lineChanges(view.state.doc, this.lines, after), effects, userEvent: "move.drag" }
      : { effects });
  }
}

/** CHK-9: start a drag from the grip, without focusing the editor or selecting text. */
function startDrag(view: EditorView, grip: HTMLElement, e: PointerEvent) {
  if (e.button > 0) return;
  e.preventDefault();
  e.stopPropagation();
  const n = view.state.doc.lineAt(view.posAtDOM(grip)).number - 1;
  if (!parseItem(view.state.doc.line(n + 1).text)) return;
  try {
    grip.setPointerCapture(e.pointerId);
  } catch {
    // the window listeners below still see the moves
  }
  const drag = new Drag(view, n, grip, e.clientX, e.pointerType === "touch");
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    ev.preventDefault();
    ev.stopPropagation();
    drag.move(ev.clientX, ev.clientY);
  };
  // Obsidian's swipes (sidebars, back) must not see this finger
  const swallow = (ev: Event) => {
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
  };
  const end = (drop: boolean) => (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("touchmove", swallow, true);
    drag.finish(drop);
  };
  const up = end(true);
  const cancel = end(false);
  // capturing on the window runs before anything else that listens
  window.addEventListener("pointermove", move, { capture: true, passive: false });
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("touchmove", swallow, { capture: true, passive: false });
}

class GripWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const grip = document.createElement("span");
    grip.className = "org-list-grip";
    grip.setAttribute("aria-label", "Drag to move; sideways to indent");
    view.state.facet(orgHost)?.setIcon(grip, "grip-vertical");
    grip.addEventListener("pointerdown", (e) => startDrag(view, grip, e));
    // no caret, no keyboard, no text selection from the grip
    for (const type of ["mousedown", "touchstart", "touchend"]) {
      grip.addEventListener(type, (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    }
    return grip;
  }
  ignoreEvent() {
    return true;
  }
}

const grip = Decoration.widget({ widget: new GripWidget(), side: -1 });
const lineDecos = new Map<string, Decoration>();
/** An item's line (`item`) or a line its text continues on, nested `depth` deep. */
function lineDeco(item: boolean, depth: number): Decoration {
  const key = `${item}:${depth}`;
  let d = lineDecos.get(key);
  if (!d) {
    const cls = [item ? "org-list-item" : "", depth > 0 ? "org-list-nested" : ""].filter(Boolean).join(" ");
    d = Decoration.line(depth > 0 ? { class: cls, attributes: { style: `--org-list-depth: ${depth}` } } : { class: cls });
    lineDecos.set(key, d);
  }
  return d;
}

/** CHK-13: each line's list depth, for the whole document. */
function depthsOf(view: EditorView): number[] {
  const structure = structureOf(view.state);
  return listDepths(docLines(view.state.doc), structure.lines.map((l) => l.kind === "text"));
}

/**
 * CHK-9, CHK-13: a grip before the bullet of every list item on the visible
 * lines, and its lines marked with their depth so nested ones stand further in.
 */
function build(view: EditorView, depths: number[]): DecorationSet {
  const state = view.state;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const depth = depths[line.number - 1] ?? -1;
      if (depth >= 0) {
        const item = parseItem(line.text);
        if (item) out.push(lineDeco(true, depth).range(line.from), grip.range(line.from + item.indent));
        else if (depth > 0) out.push(lineDeco(false, depth).range(line.from));
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

const gripPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    depths: number[];
    constructor(view: EditorView) {
      this.depths = depthsOf(view);
      this.decorations = build(view, this.depths);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.depths = depthsOf(update.view);
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view, this.depths);
    }
  },
  { decorations: (v) => v.decorations },
);

export function listDrag() {
  return [gripPlugin, draggedField];
}
