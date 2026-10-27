import { describe, expect, test } from "vitest";
import { Text } from "@codemirror/state";
import { analyze } from "../src/org/syntax";
import { crumbs, headingAbove, hiddenRanges, subtreeRange } from "../src/org/zoom";
import { findNodes } from "../src/org/node-find";
import { offerCreate } from "../src/org/new-note";

const lines = ["intro", "* A", "a", "** B", "b", "*** C", "c", "** D", "* E", "e"];
const doc = Text.of(lines);
const structure = analyze(lines);
const kw = { todo: ["TODO"], done: ["DONE"] };
const slice = (r: { from: number; to: number }) => doc.sliceString(r.from, r.to);

describe("zoom", () => {
  test("the zoom covers a heading and its subtree, and the rest is hidden as whole lines", () => {
    expect(headingAbove(structure, 0)).toBeNull();
    expect(headingAbove(structure, 4)).toBe(3);
    const b = subtreeRange(doc, structure, 3);
    expect(slice(b)).toBe("** B\nb\n*** C\nc");
    expect(hiddenRanges(doc, b).map(slice)).toEqual(["intro\n* A\na", "** D\n* E\ne"]);
    const e = subtreeRange(doc, structure, 8);
    expect(slice(e)).toBe("* E\ne");
    expect(hiddenRanges(doc, e).map(slice)).toEqual(["intro\n* A\na\n** B\nb\n*** C\nc\n** D"]);
  });

  test("breadcrumbs go from the top-level heading down to the zoomed one, by title", () => {
    const d = Text.of(["* TODO Top :tag:", "** [[id:x][Link]] middle", "text", "*** Deep"]);
    expect(crumbs(d, analyze(d.toJSON()), 3, kw)).toEqual([
      { line: 0, title: "Top" }, { line: 1, title: "Link middle" }, { line: 3, title: "Deep" },
    ]);
    expect(crumbs(doc, structure, 8, kw)).toEqual([{ line: 8, title: "E" }]);
  });
});

describe("go to node", () => {
  const nodes = [
    { label: "Org roam", detail: "notes", id: "1" },
    { label: "Roam research", id: "2" },
    { label: "Heading", detail: "Org roam", id: "3" },
  ];
  const contains = (q: string) => (label: string) => {
    const i = label.toLowerCase().indexOf(q.trim().toLowerCase());
    return i < 0 ? null : -i;
  };
  const ids = (q: string) => findNodes(nodes.map((n) => ({ ...n, target: `id:${n.id}` })), q, contains(q)).map((c) => (c.kind === "node" ? c.node.id : `+${c.title}`));

  test("findNodes ranks matching nodes and ends with a create entry for a new title", () => {
    expect(ids("")).toEqual(["1", "2", "3"]);
    expect(ids("roam")).toEqual(["2", "1", "+roam"]);
    expect(ids(" org ROAM ")).toEqual(["1"]);
    expect(ids("nothing")).toEqual(["+nothing"]);
  });

  test("offerCreate needs a title nobody has, ignoring case and spaces", () => {
    expect(offerCreate(["A note"], "a NOTE ")).toBe(false);
    expect(offerCreate(["A note"], "  ")).toBe(false);
    expect(offerCreate(["A note"], "A note 2")).toBe(true);
  });
});
