// Zoom (§7a): show only one heading and its subtree, with a breadcrumb strip
// on top to zoom out again. The rest of the file is hidden, not removed: it is
// saved as it is, and edits inside the zoom grow or shrink it.

import { EditorSelection, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, Panel, showPanel, ViewUpdate, WidgetType } from "@codemirror/view";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { crumbs, headingAbove, hiddenRanges, subtreeRange, ZoomRange } from "../org/zoom";
import { onTap, orgConfig, orgHost, structureOf } from "./state";

export const setZoom = StateEffect.define<ZoomRange | null>({
  map: (z, mapping) => (z ? { from: mapping.mapPos(z.from, -1), to: mapping.mapPos(z.to, 1) } : null),
});

/** ZOOM-1: the zoomed range, kept in place through edits; null when not zoomed. */
export const zoomField = StateField.define<ZoomRange | null>({
  create: () => null,
  update(zoom, tr) {
    for (const e of tr.effects) if (e.is(setZoom)) return e.value;
    if (!zoom || !tr.docChanged) return zoom;
    const from = tr.changes.mapPos(zoom.from, -1);
    const to = tr.changes.mapPos(zoom.to, 1);
    // the zoomed heading's text is gone: show everything again
    return to > from ? { from, to } : null;
  },
});

class Hidden extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "org-zoom-hidden";
    return el;
  }
}
const hidden = Decoration.replace({ widget: new Hidden(), block: true });

function hiddenDecorations(state: EditorState): DecorationSet {
  const zoom = state.field(zoomField);
  if (!zoom) return Decoration.none;
  return Decoration.set(hiddenRanges(state.doc, zoom).map((r) => hidden.range(r.from, r.to)));
}

const hiddenField = StateField.define<DecorationSet>({
  create: hiddenDecorations,
  update: (deco, tr) => (tr.docChanged || tr.startState.field(zoomField) !== tr.state.field(zoomField) ? hiddenDecorations(tr.state) : deco),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

/** ZOOM-1: the cursor never goes into the hidden text (Ctrl+Home, select all, a search hit). */
const keepSelectionInside = EditorState.transactionFilter.of((tr) => {
  const zoom = tr.state.field(zoomField);
  if (!zoom || !tr.selection) return tr;
  const clamp = (pos: number) => Math.min(Math.max(pos, zoom.from), zoom.to);
  const sel = tr.selection;
  if (sel.ranges.every((r) => clamp(r.anchor) === r.anchor && clamp(r.head) === r.head)) return tr;
  return [tr, {
    selection: EditorSelection.create(sel.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head))), sel.mainIndex),
    sequential: true,
  }];
});

/** ZOOM-1: zoom into heading line `h` (0-based), opening the folds over it, with the heading at the top. */
export function zoomTo(view: EditorView, h: number) {
  const state = view.state;
  const zoom = subtreeRange(state.doc, structureOf(state), h);
  const effects: StateEffect<unknown>[] = [setZoom.of(zoom)];
  const line = state.doc.line(h + 1);
  // the heading's own fold, and any fold of a parent that hides it
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    if (from <= line.to && to >= line.from) effects.push(unfoldEffect.of({ from, to }));
  });
  const head = state.selection.main.head;
  const inside = head >= zoom.from && head <= zoom.to;
  view.dispatch({
    effects: [...effects, EditorView.scrollIntoView(zoom.from, { y: "start" })],
    selection: inside ? undefined : EditorSelection.cursor(line.to),
  });
}

/** ZOOM-5: zoom into the heading that starts the line at `pos`, cursor at its start. False when that line is no heading. */
export function zoomToHeadingAt(view: EditorView, pos: number): boolean {
  const state = view.state;
  const line = state.doc.lineAt(Math.min(pos, state.doc.length));
  if (structureOf(state).lines[line.number - 1]?.kind !== "heading") return false;
  view.dispatch({ effects: setZoom.of(null), selection: EditorSelection.cursor(line.from) });
  zoomTo(view, line.number - 1);
  return true;
}

/** ZOOM-6: zoom into the heading on the line at `pos`, or out when it is the one zoomed into. Nothing for other lines. */
export function zoomAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  if (structureOf(view.state).lines[line.number - 1]?.kind !== "heading") return;
  if (view.state.field(zoomField, false)?.from === line.from) zoomOut(view);
  else zoomTo(view, line.number - 1);
}

/** ZOOM-4: the effect that zooms out when `pos` is hidden by the zoom, for jumps (links, backlinks, search). */
export function revealZoomEffects(state: EditorState, pos: number): StateEffect<unknown>[] {
  const zoom = state.field(zoomField, false);
  return zoom && (pos < zoom.from || pos > zoom.to) ? [setZoom.of(null)] : [];
}

/** ZOOM-3: show the whole file again, keeping the cursor in view. */
export function zoomOut(view: EditorView) {
  view.dispatch({ effects: [setZoom.of(null), EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" })] });
}

/** ZOOM-1, ZOOM-3: zoom into the heading the cursor is under, or out when zoomed. False when there is no heading. */
export function toggleZoom(view: EditorView): boolean {
  if (view.state.field(zoomField, false)) {
    zoomOut(view);
    return true;
  }
  const state = view.state;
  const h = headingAbove(structureOf(state), state.doc.lineAt(state.selection.main.head).number - 1);
  if (h === null) return false;
  zoomTo(view, h);
  return true;
}

/** ZOOM-2: the breadcrumb strip on top: the file, then each heading down to the zoomed one. */
class Breadcrumbs implements Panel {
  dom: HTMLElement;
  top = true;
  private key = "";

  constructor(private view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "org-zoom-bar";
    this.render();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.startState.field(zoomField) !== update.state.field(zoomField)) this.render();
  }

  private render() {
    const view = this.view;
    const state = view.state;
    const zoom = state.field(zoomField);
    if (!zoom) return;
    const structure = structureOf(state);
    const h = state.doc.lineAt(zoom.from).number - 1;
    const path = structure.lines[h]?.kind === "heading" ? crumbs(state.doc, structure, h, state.facet(orgConfig).keywords) : [];
    const root = state.facet(orgHost)?.title?.() || "Whole file";
    const key = JSON.stringify([root, path]);
    if (key === this.key) return;
    this.key = key;
    this.dom.replaceChildren();
    const add = (text: string, action: (() => void) | null) => {
      if (this.dom.childElementCount) {
        const sep = this.dom.appendChild(document.createElement("span"));
        sep.className = "org-zoom-sep";
        sep.textContent = "›";
      }
      const crumb = this.dom.appendChild(document.createElement("span"));
      crumb.className = "org-zoom-crumb";
      crumb.textContent = text || "(untitled)";
      if (action) onTap(crumb, action);
      else crumb.classList.add("is-current");
    };
    add(root, () => zoomOut(view));
    path.forEach((c, i) => add(c.title, i === path.length - 1 ? null : () => zoomTo(view, c.line)));
  }
}

export function orgZoom() {
  return [
    zoomField,
    Prec.highest(hiddenField),
    keepSelectionInside,
    showPanel.from(zoomField, (zoom) => (zoom ? (view) => new Breadcrumbs(view) : null)),
  ];
}
