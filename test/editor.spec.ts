// Editor extensions that can run without a DOM: folding on open, the front
// matter rules and the visibility effects.
import { expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { foldable, foldedRanges } from "@codemirror/language";
import { docInfo, orgConfig, DEFAULT_CONFIG } from "../src/editor/state";
import { orgFolding, visibilityEffects } from "../src/editor/folding";
import { panelState, revealFrontMatter } from "../src/editor/front-matter-panel";

const journal = ":PROPERTIES:\n:ID:       2024-01-02\n:END:\n#+title: 2024-01-02\n#+filetags: :journal:\n\n* a\ntext\n* b\n:PROPERTIES:\n:ID: b\n:END:\nmore\n";

function make(frontMatterPanel: boolean, doc = journal) {
  const extensions = [orgConfig.of({ ...DEFAULT_CONFIG, frontMatterPanel }), docInfo, orgFolding()];
  return EditorState.create({ doc, extensions: frontMatterPanel ? [extensions, panelState] : extensions });
}

function folded(state: EditorState): string[] {
  const out: string[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => void out.push(`${state.doc.lineAt(from).number}-${state.doc.lineAt(to).number}`));
  return out;
}

test("default fold level 'foldall' folds top-level headings; drawers stay folded", () => {
  const s = make(false);
  const opened = s.update({ effects: visibilityEffects(s, "foldall") }).state;
  expect(folded(opened)).toEqual(["1-3", "7-8", "9-13", "10-12"]);
});

test("the front matter drawer is not foldable while the panel is on", () => {
  const on = make(true);
  expect(foldable(on, 0, on.doc.line(1).to)).toBeNull();
  expect(folded(on.update({ effects: visibilityEffects(on, "expandall") }).state)).toEqual(["10-12"]);
  const off = make(false);
  expect(foldable(off, 0, off.doc.line(1).to)).not.toBeNull();
});

test("the source shows only when the user moves into the front matter", () => {
  let s = make(true);
  expect(s.field(panelState).revealed).toBe(false);
  // a transaction that isn't the user moving (folds on open) changes nothing
  s = s.update({ effects: visibilityEffects(s, "foldall") }).state;
  expect(s.field(panelState).revealed).toBe(false);
  // keyboard movement into the front matter reveals it
  s = s.update({ selection: EditorSelection.cursor(5), userEvent: "select" }).state;
  expect(s.field(panelState).revealed).toBe(true);
  // leaving it brings the panel back
  s = s.update({ selection: EditorSelection.cursor(s.doc.length), userEvent: "select.pointer" }).state;
  expect(s.field(panelState).revealed).toBe(false);
  s = s.update({ effects: revealFrontMatter.of(true), selection: EditorSelection.cursor(3) }).state;
  expect(s.field(panelState).revealed).toBe(true);
});
