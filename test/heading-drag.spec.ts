import { expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { dropGaps, moveSubtree, subtreeRange } from "../src/editor/heading-drag";

function state(doc: string) {
  return EditorState.create({ doc, extensions: [codeFolding(), history()] });
}

const doc = "* a\nA\n** a1\n* b\nB\n* c\nC\n";

test("subtreeRange takes the heading and everything below it up to a heading of the same or higher level", () => {
  const s = state(doc);
  expect(s.sliceDoc(...Object.values(subtreeRange(s, 0)!) as [number, number])).toBe("* a\nA\n** a1\n");
  expect(s.sliceDoc(...Object.values(subtreeRange(s, doc.indexOf("** a1"))!) as [number, number])).toBe("** a1\n");
  expect(s.sliceDoc(...Object.values(subtreeRange(s, doc.indexOf("* c"))!) as [number, number])).toBe("* c\nC\n");
  expect(subtreeRange(s, doc.indexOf("A"))).toBeNull();
});

test("moveSubtree moves a heading with its subtree up and down, keeping its level", () => {
  const s = state(doc);
  const a = subtreeRange(s, 0)!;
  const down = s.update(moveSubtree(s, a, doc.indexOf("* c"))!).state;
  expect(down.doc.toString()).toBe("* b\nB\n* a\nA\n** a1\n* c\nC\n");
  expect(down.selection.main.head).toBe("* b\nB\n".length);
  const a1 = subtreeRange(s, doc.indexOf("** a1"))!;
  const up = s.update(moveSubtree(s, a1, doc.length)!).state;
  expect(up.doc.toString()).toBe("* a\nA\n* b\nB\n* c\nC\n** a1\n");
});

test("dropGaps lists visible heading starts outside the dragged subtree and the end", () => {
  let s = state(doc);
  const a = subtreeRange(s, 0)!;
  expect(dropGaps(s, a)).toEqual([0, doc.indexOf("* b"), doc.indexOf("* c"), doc.length]);
  // fold b's body and a: a1 is hidden
  s = s.update({ effects: foldEffect.of({ from: 3, to: doc.indexOf("* b") - 1 }) }).state;
  expect(dropGaps(s, subtreeRange(s, doc.indexOf("* c"))!)).toEqual([0, doc.indexOf("* b"), doc.indexOf("* c"), doc.length]);
});

test("moveSubtree handles a document without a final newline and refuses no-op drops", () => {
  const text = "* a\nA\n* b\nB";
  const s = state(text);
  const b = subtreeRange(s, text.indexOf("* b"))!;
  expect(s.update(moveSubtree(s, b, 0)!).state.doc.toString()).toBe("* b\nB\n* a\nA");
  const a = subtreeRange(s, 0)!;
  const moved = s.update(moveSubtree(s, a, text.length)!).state;
  expect(moved.doc.toString()).toBe("* b\nB\n* a\nA");
  expect(moved.selection.main.head).toBe("* b\nB\n".length);
  expect(moveSubtree(s, a, 0)).toBeNull();
  expect(moveSubtree(s, a, a.to)).toBeNull();
  expect(moveSubtree(s, b, text.length)).toBeNull();
});

test("moveSubtree is one undoable change and carries folds along", () => {
  let s = state(doc);
  s = s.update({ effects: foldEffect.of({ from: 3, to: doc.indexOf("* b") - 1 }) }).state;
  const moved = s.update(moveSubtree(s, subtreeRange(s, 0)!, doc.length)!).state;
  const folds: [number, number][] = [];
  foldedRanges(moved).between(0, moved.doc.length, (from, to) => void folds.push([from, to]));
  const start = "* b\nB\n* c\nC\n".length;
  expect(folds).toEqual([[start + 3, start + doc.indexOf("* b") - 1]]);
  let undone = moved;
  undo({ state: moved, dispatch: (tr) => (undone = tr.state) });
  expect(undone.doc.toString()).toBe(doc);
});
