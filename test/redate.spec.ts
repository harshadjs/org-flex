import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { assignId, createdAt, idAt } from "../src/org/edit";
import { setCreated } from "../src/org/redate";
import { createdStamp, parseCreated } from "../src/org/ids";

const at = (doc: string, pos: number) => EditorState.create({ doc, selection: EditorSelection.cursor(pos) });

describe("setting a node's created time", () => {
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
    expect(createdAt(at(doc, pos("body of A")))).toBe("x");
    expect(createdAt(at(doc, pos("intro")))).toBeNull();
    // a heading without an ID gets one dated as asked, as the ID button would
    expect(assignId(at(doc, pos("no drawer")), "20200101T000000.000000")).not.toBeNull();
  });

  test("a created stamp is an inactive timestamp to the minute, and parses back", () => {
    const date = new Date(2019, 4, 6, 7, 8, 9, 750);
    expect(createdStamp(date)).toBe("[2019-05-06 Mon 07:08]");
    expect(parseCreated("[2019-05-06 Mon 07:08]")).toEqual(new Date(2019, 4, 6, 7, 8));
    expect(parseCreated("<2019-05-06 Mon 07:08:09>")).toEqual(new Date(2019, 4, 6, 7, 8, 9));
    expect(parseCreated("[2019-05-06]")).toEqual(new Date(2019, 4, 6));
    expect(parseCreated("[2019-05-06 Mon]")).toEqual(new Date(2019, 4, 6));
    expect(parseCreated("yesterday")).toBeNull();
    expect(parseCreated(undefined)).toBeNull();
  });

  test("setCreated rewrites the node's CREATED, or adds one under its ID, and nothing else", () => {
    const text = [
      ":PROPERTIES:", ":ID:       file-id", ":END:", "#+title: T",
      "* A", "  :PROPERTIES:", "  :ID:       a-id", "  :CREATED:  [2020-01-01 Wed 00:00]", "  :END:", "see [[id:a-id]]",
      "* B", ":PROPERTIES:", ":ID:       b-id", ":END:",
    ].join("\n");
    const a = setCreated(text, "a-id", "[2019-05-06 Mon 07:08]")!.split("\n");
    expect(a[7]).toBe("  :CREATED:  [2019-05-06 Mon 07:08]");
    expect(a[6]).toBe("  :ID:       a-id");
    expect(a[9]).toBe("see [[id:a-id]]");
    expect(a.length).toBe(14);
    const b = setCreated(text, "b-id", "[2019-05-06 Mon 07:08]")!.split("\n");
    expect(b.slice(11)).toEqual([":PROPERTIES:", ":ID:       b-id", ":CREATED:  [2019-05-06 Mon 07:08]", ":END:"]);
    const f = setCreated(text, "file-id", "[2019-05-06 Mon 07:08]")!.split("\n");
    expect(f.slice(0, 4)).toEqual([":PROPERTIES:", ":ID:       file-id", ":CREATED:  [2019-05-06 Mon 07:08]", ":END:"]);
    expect(f.slice(4)).toEqual(text.split("\n").slice(3));
    expect(setCreated(text, "a", "[2019-05-06 Mon 07:08]")).toBeNull();
  });
});
