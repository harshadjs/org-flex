// Folding in the editor (§6): what folds, the gutter arrows and the three
// visibility levels.

import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeFolding, foldedRanges, foldEffect, foldGutter, foldService, unfoldEffect } from "@codemirror/language";
import { foldAt, FoldOptions, visibilityFolds, VisibilityLevel } from "../org/folding";
import { docInfo, orgConfig, structureOf } from "./state";

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

export function orgFolding() {
  return [
    foldService.of((state, lineStart) => {
      const n = state.doc.lineAt(lineStart).number - 1;
      return foldAt(state.doc, structureOf(state), n, foldOptions(state));
    }),
    codeFolding({ placeholderText: "…" }),
    foldGutter({ markerDOM: arrow }),
    visibilityField,
  ];
}
