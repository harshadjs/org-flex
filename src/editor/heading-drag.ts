// Reordering headings by dragging (§6a). A grip next to each heading starts
// a pointer drag; the heading moves with its subtree to the gap the pointer
// is nearest to, keeping its level.

import { EditorState, StateEffect, TransactionSpec } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import { foldedRanges, foldEffect } from "@codemirror/language";
import { headingLevel } from "../org/syntax";
import { orgHost } from "./state";

export interface Range {
  from: number;
  to: number;
}

/** DRAG-2: the heading on the line at `pos` with its subtree, [from, to). */
export function subtreeRange(state: EditorState, pos: number): Range | null {
  const first = state.doc.lineAt(pos);
  const level = headingLevel(first.text);
  if (!level) return null;
  for (let n = first.number + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const l = headingLevel(line.text);
    if (l && l <= level) return { from: first.from, to: line.from };
  }
  return { from: first.from, to: state.doc.length };
}

function isHidden(state: EditorState, pos: number): boolean {
  let hidden = false;
  foldedRanges(state).between(pos, pos, (from, to) => {
    if (from < pos && to >= pos) hidden = true;
  });
  return hidden;
}

/** DRAG-3: starts of visible headings outside `src`, plus the document end, within [from, to]. */
export function dropGaps(state: EditorState, src: Range, from = 0, to = state.doc.length): number[] {
  const gaps: number[] = [];
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
    const line = state.doc.line(n);
    if (!headingLevel(line.text)) continue;
    if (line.from > src.from && line.from < src.to) continue;
    if (isHidden(state, line.from)) continue;
    gaps.push(line.from);
  }
  if (to >= state.doc.length && !gaps.includes(state.doc.length)) gaps.push(state.doc.length);
  return gaps;
}

/**
 * DRAG-2, DRAG-4: move subtree `src` to `gap` (a heading start outside it, or
 * the document end) as one transaction, carrying its folds along. Null when
 * the move changes nothing.
 */
export function moveSubtree(state: EditorState, src: Range, gap: number): TransactionSpec | null {
  if (gap >= src.from && gap <= src.to) return null;
  const doc = state.doc;
  let text = doc.sliceString(src.from, src.to);
  let removeFrom = src.from;
  // the last subtree has no final newline: take the one before it instead
  if (!text.endsWith("\n")) {
    text += "\n";
    if (removeFrom > 0) removeFrom--;
  }
  let insert = text;
  if (gap === doc.length) {
    const endsWithNewline = doc.length === 0 || doc.sliceString(doc.length - 1) === "\n";
    // keep "no final newline" as it was
    insert = endsWithNewline ? text : "\n" + text.slice(0, -1);
    if (gap === src.to && src.to === doc.length) return null;
  }
  const changes = state.changes([{ from: gap, insert }, { from: removeFrom, to: src.to }]);
  const start = changes.mapPos(gap, -1) + (insert.startsWith("\n") && !text.startsWith("\n") ? 1 : 0);
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(state).between(src.from, src.to, (from, to) => {
    if (from >= src.from && to <= src.to) {
      effects.push(foldEffect.of({ from: start + from - src.from, to: start + to - src.from }));
    }
  });
  return { changes, effects, selection: { anchor: start }, scrollIntoView: true, userEvent: "move.drag" };
}

class Grip extends GutterMarker {
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "org-drag-grip";
    el.setAttribute("aria-label", "Drag to move this heading");
    view.state.facet(orgHost)?.setIcon(el, "grip-vertical");
    return el;
  }
}
const grip = new Grip();

class Drag {
  private line: HTMLElement;
  private gap: number | null = null;
  private y = 0;
  private timer: number | null = null;

  constructor(private view: EditorView, private src: Range) {
    this.line = view.dom.appendChild(document.createElement("div"));
    this.line.className = "org-drop-line is-hidden";
    view.dom.classList.add("org-dragging");
  }

  move(y: number) {
    this.y = y;
    const view = this.view;
    const docY = y - view.documentTop;
    let best: number | null = null;
    let bestTop = 0;
    let distance = Infinity;
    for (const gap of dropGaps(view.state, this.src, view.viewport.from, view.viewport.to)) {
      const block = view.lineBlockAt(gap);
      const top = gap === view.state.doc.length && gap !== block.from ? block.bottom : block.top;
      if (Math.abs(top - docY) < distance) {
        distance = Math.abs(top - docY);
        best = gap;
        bestTop = top;
      }
    }
    this.gap = best;
    const noop = best === null || (best >= this.src.from && best <= this.src.to);
    this.line.classList.toggle("is-hidden", noop);
    if (!noop) {
      const editor = view.dom.getBoundingClientRect();
      const content = view.contentDOM.getBoundingClientRect();
      this.line.style.top = `${bestTop + view.documentTop - editor.top - 1}px`;
      this.line.style.left = `${content.left - editor.left}px`;
      this.line.style.width = `${content.width}px`;
    }
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
      const speed = this.speed();
      if (!speed) return this.stopScrolling();
      this.view.scrollDOM.scrollTop += speed;
      this.view.requestMeasure({ read: () => null, write: () => this.move(this.y) });
    }, 30);
  }

  private stopScrolling() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  finish(drop: boolean) {
    this.stopScrolling();
    this.line.remove();
    this.view.dom.classList.remove("org-dragging");
    if (drop && this.gap !== null) {
      const spec = moveSubtree(this.view.state, this.src, this.gap);
      if (spec) this.view.dispatch(spec);
    }
  }
}

/** DRAG-1: the grip gutter. */
export function headingDrag() {
  return gutter({
    class: "org-drag-gutter",
    lineMarker: (view, line) => (headingLevel(view.state.doc.lineAt(line.from).text) ? grip : null),
    lineMarkerChange: (update) => update.docChanged,
    domEventHandlers: {
      pointerdown(view, line, event) {
        const e = event as PointerEvent;
        const handle = (e.target as HTMLElement).closest(".org-drag-grip") as HTMLElement | null;
        if (!handle || e.button > 0) return false;
        const src = subtreeRange(view.state, line.from);
        if (!src) return false;
        // no focus, no selection, no scrolling
        e.preventDefault();
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {
          // the window listeners below still see the moves
        }
        const drag = new Drag(view, src);
        const moveListener = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return;
          ev.preventDefault();
          drag.move(ev.clientY);
        };
        const end = (drop: boolean) => (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return;
          window.removeEventListener("pointermove", moveListener);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
          drag.finish(drop);
        };
        const up = end(true);
        const cancel = end(false);
        window.addEventListener("pointermove", moveListener, { passive: false });
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        return true;
      },
    },
  });
}
