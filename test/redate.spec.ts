import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { assignId, idAt } from "../src/org/edit";
import { datedId, rewriteId } from "../src/org/redate";

const at = (doc: string, pos: number) => EditorState.create({ doc, selection: EditorSelection.cursor(pos) });

describe("re-dating IDs", () => {
  test("idAt finds the enclosing heading's ID, or the file's above the first heading", () => {
    const doc = [
      ":PROPERTIES:", ":ID:       file-id", ":END:", "#+title: T", "intro",
      "* A", "SCHEDULED: <2026-10-30 Fri>", ":PROPERTIES:", ":CREATED: x", ":ID:       a-id", ":END:", "body of A",
      "** B", "no drawer", "* C", ":PROPERTIES:", ":ID:", ":END:",
    ].join("\n");
    const pos = (text: string) => doc.indexOf(text);
    expect(idAt(at(doc, pos("intro")))).toBe("file-id");
    expect(idAt(at(doc, pos("body of A")))).toBe("a-id");
    expect(idAt(at(doc, pos("no drawer")))).toBeNull();
    expect(idAt(at(doc, pos("* C")))).toBeNull();
    // a heading without an ID gets one dated as asked, as the ID button would
    expect(assignId(at(doc, pos("no drawer")), "20200101T000000.000000")).not.toBeNull();
  });

  test("a dated ID is ts style at the picked second, a microsecond later while taken", () => {
    const date = new Date(2019, 4, 6, 7, 8, 9, 750);
    expect(datedId(date, new Set())).toBe("20190506T070809.000000");
    expect(datedId(date, new Set(["20190506T070809.000000", "20190506T070809.000001"]))).toBe("20190506T070809.000002");
  });

  test("rewriteId changes the ID property and every link to it, and nothing else", () => {
    const text = [
      ":PROPERTIES:", ":ID:       1793101200000000", ":END:",
      "see [[id:1793101200000000]] and [[id:1793101200000000][the note]] and [[id:1793101200000000::*Part]]",
      "not [[id:17931012000000001]] nor [[id:x1793101200000000]] nor id:1793101200000000 in prose",
      ":ROAM_REFS: 1793101200000000",
    ].join("\n");
    const out = rewriteId(text, "1793101200000000", "20261030T100000.000000")!;
    expect(out.links).toBe(3);
    expect(out.property).toBe(true);
    expect(out.text.split("\n")).toEqual([
      ":PROPERTIES:", ":ID:       20261030T100000.000000", ":END:",
      "see [[id:20261030T100000.000000]] and [[id:20261030T100000.000000][the note]] and [[id:20261030T100000.000000::*Part]]",
      "not [[id:17931012000000001]] nor [[id:x1793101200000000]] nor id:1793101200000000 in prose",
      ":ROAM_REFS: 1793101200000000",
    ]);
    expect(rewriteId("only [[id:abc]] here", "abc", "new")).toEqual({ text: "only [[id:new]] here", links: 1, property: false });
    expect(rewriteId("nothing to see", "abc", "new")).toBeNull();
    expect(rewriteId("[[id:abcd]]", "abc", "new")).toBeNull();
  });
});
