// Folding in the editor (§6): what folds, the arrows hanging in the left
// margin of each foldable line and the three visibility levels.

import { EditorState, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { codeFolding, foldable, foldedRanges, foldEffect, foldService, unfoldEffect } from "@codemirror/language";
import { foldAt, FoldOptions, visibilityFolds, VisibilityLevel } from "../org/folding";
import { docInfo, onTap, orgConfig, selectionTouches, structureOf } from "./state";

export function foldOptions(state: EditorState): FoldOptions {
  const fm = state.field(docInfo).frontMatter;
  return { lockedDrawer: fm && fm.drawerLine !== null ? fm.drawerLine : null };
}

export const setVisibility = StateEffect.define<VisibilityLevel>();

/** The level last applied, for the bar button's icon (BAR-6) and cycling (FOLD-6). */
export const visibilityField = StateField.define<VisibilityLevel>({
  create: () => "expandall",
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setVisibility)) value = e.value;
    return value;
  },
});

/** The effects that apply `level`: every current fold opens, then the level's folds close. */
export function visibilityEffects(state: EditorState, level: VisibilityLevel): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  const config = state.facet(orgConfig);
  for (const range of visibilityFolds(state.doc, structureOf(state), level, config.foldPropertyDrawers, foldOptions(state))) {
    effects.push(foldEffect.of(range));
  }
  effects.push(setVisibility.of(level));
  return effects;
}

export function applyVisibility(view: EditorView, level: VisibilityLevel) {
  view.dispatch({ effects: visibilityEffects(view.state, level) });
}

const SVG_NS = "http://www.w3.org/2000/svg";
function arrow(open: boolean): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "org-fold-marker" + (open ? " is-open" : " is-folded");
  wrap.title = open ? "Fold" : "Unfold";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  wrap.appendChild(svg);
  return wrap;
}

/** The fold that starts on the line [from, to], if any. */
function foldOn(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(state).between(from, to, (a, b) => {
    if (!found && a >= from && a <= to) found = { from: a, to: b };
  });
  return found;
}

/** Folds the line at `pos` if it's open, opens it if it's folded. False when it can't fold. */
export function toggleFoldAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const folded = foldOn(view.state, line.from, line.to);
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return true;
  }
  const range = foldable(view.state, line.from, line.to);
  if (!range) return false;
  view.dispatch({ effects: foldEffect.of(range) });
  return true;
}

/**
 * FOLD-3: the arrow hanging in the left margin of a foldable line. It shows
 * on folded headings and on the cursor's line; elsewhere it's invisible but
 * still takes taps.
 */
class FoldToggle extends WidgetType {
  constructor(readonly open: boolean, readonly shown: boolean) {
    super();
  }
  eq(other: FoldToggle) {
    return other.open === this.open && other.shown === this.shown;
  }
  toDOM(view: EditorView) {
    const el = arrow(this.open);
    el.classList.add("org-fold-toggle");
    if (this.shown) el.classList.add("is-shown");
    el.setAttribute("aria-label", el.title);
    onTap(el, () => toggleFoldAt(view, view.posAtDOM(el)));
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
const toggles = new Map<string, Decoration>();
function toggle(open: boolean, shown: boolean): Decoration {
  const key = `${open} ${shown}`;
  let d = toggles.get(key);
  if (!d) toggles.set(key, (d = Decoration.widget({ widget: new FoldToggle(open, shown), side: -1 })));
  return d;
}

function foldToggles(view: EditorView): DecorationSet {
  const state = view.state;
  const structure = structureOf(state);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      const folded = foldOn(state, line.from, line.to);
      if (folded || foldable(state, line.from, line.to)) {
        const heading = structure.lines[line.number - 1]?.kind === "heading";
        const shown = (folded !== null && heading) || selectionTouches(state, line.from, line.to);
        out.push(toggle(!folded, shown).range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out);
}

const foldTogglePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = foldToggles(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet ||
          foldedRanges(update.startState) !== foldedRanges(update.state) ||
          update.startState.facet(orgConfig) !== update.state.facet(orgConfig)) {
        this.decorations = foldToggles(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function orgFolding() {
  return [
    foldService.of((state, lineStart) => {
      const n = state.doc.lineAt(lineStart).number - 1;
      return foldAt(state.doc, structureOf(state), n, foldOptions(state));
    }),
    codeFolding({ placeholderText: "…" }),
    foldTogglePlugin,
    visibilityField,
  ];
}
