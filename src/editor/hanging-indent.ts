// Hanging indent for list items (CHK-14): when an item's line wraps, the
// following screen lines start under its text, past the grip, bullet and
// checkbox, as in Google Docs. Where the text starts depends on the font and
// the widgets, so it is measured, and the line gets a transparent left border
// of that width with the same negative text-indent: the first line stays put.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { parseItem } from "../org/lists";
import { structureOf } from "./state";

/** The hang, in whole pixels, of each item line, by the line's start. */
const setHangs = StateEffect.define<Map<number, number>>();

const decos = new Map<number, Decoration>();
function hangDeco(px: number): Decoration {
  let d = decos.get(px);
  if (!d) decos.set(px, (d = Decoration.line({ class: "org-list-hang", attributes: { style: `--org-list-hang: ${px}px` } })));
  return d;
}

const hangField = StateField.define<{ hangs: Map<number, number>; deco: DecorationSet }>({
  create: () => ({ hangs: new Map(), deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setHangs)) continue;
      const ranges = Array.from(e.value).sort((a, b) => a[0] - b[0]).map(([from, px]) => hangDeco(px).range(from));
      return { hangs: e.value, deco: Decoration.set(ranges) };
    }
    if (!tr.docChanged) return value;
    // keep them in place until the next measure
    const hangs = new Map<number, number>();
    for (const [from, px] of value.hangs) {
      const to = tr.changes.mapPos(from, -1);
      if (tr.state.doc.lineAt(to).from === to) hangs.set(to, px);
    }
    return { hangs, deco: value.deco.map(tr.changes) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** CHK-14: where each visible item's text starts, from the start of its line's text box. */
function measure(view: EditorView): Map<number, number> {
  const state = view.state;
  const structure = structureOf(state);
  const hangs = new Map<number, number>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const item = structure.lines[line.number - 1]?.kind === "text" ? parseItem(line.text) : null;
      if (item) {
        const { node } = view.domAtPos(line.from);
        const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
        const text = view.coordsAtPos(line.from + item.textFrom, 1);
        if (el && text) {
          const style = getComputedStyle(el);
          const start = el.getBoundingClientRect().left + (parseFloat(style.borderLeftWidth) || 0) +
            (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.textIndent) || 0);
          const px = Math.round(text.left - start);
          if (px > 0) hangs.set(line.from, px);
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return hangs;
}

function same(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

const measurer = ViewPlugin.fromClass(class {
  private gone = false;
  constructor(view: EditorView) {
    this.schedule(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) this.schedule(update.view);
  }
  schedule(view: EditorView) {
    view.requestMeasure({
      key: this,
      read: (v) => measure(v),
      write: (hangs, v) => {
        if (same(hangs, v.state.field(hangField).hangs)) return;
        // no dispatching while CodeMirror measures
        queueMicrotask(() => {
          if (!this.gone && !same(hangs, v.state.field(hangField).hangs)) v.dispatch({ effects: setHangs.of(hangs) });
        });
      },
    });
  }
  destroy() {
    this.gone = true;
  }
});

export function hangingIndent() {
  return [hangField, measurer];
}
