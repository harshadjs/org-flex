import { describe, expect, test } from "vitest";
import {
  cardLines, cleanGridFilter, cleanLabel, fileTagsOf, filterCards, gridColor, gridColumns, gridLabels, headerKeyword, isPinned,
  masonry, NO_GRID_FILTER, previewLines, readCard, setFileTags, setKeyword, sortCards,
} from "../src/org/grid";
import { readNote } from "../src/org/vault-index";

const card = (path: string, text: string, mtime = 0) => readCard(readNote(path, text), mtime);
const NOTE = [":PROPERTIES:", ":ID:       20250701T000000.000000", ":END:", "#+title: Oahu", "#+filetags: :travellog:hawaii:", "#+pinned: t", "#+color: Yellow", "", "Body"].join("\n");

describe("notes grid", () => {
  test("a card is a note's title, labels, pin and colour, read from its #+ lines before the first heading", () => {
    const c = card("notes/travel/2507-oahu.org", NOTE, 5);
    expect(c).toMatchObject({ title: "Oahu", tags: ["travellog", "hawaii"], pinned: true, color: "yellow", mtime: 5 });
    expect(c.haystack).toContain("body");
    expect(headerKeyword("* H\n#+pinned: t", "pinned")).toBeNull();
    expect(fileTagsOf("#+filetags: :a:b:\n#+FILETAGS: :b:c:\n* H\n#+filetags: :x:")).toEqual(["a", "b", "c"]);
    expect([isPinned("t"), isPinned("Yes"), isPinned("true"), isPinned("1"), isPinned("nil"), isPinned(null)]).toEqual([true, true, true, true, false, false]);
    expect([gridColor("TEAL"), gridColor("magenta"), gridColor(null)]).toEqual(["teal", null, null]);
  });

  test("a card shows the opening lines: no drawers, keywords, planning or comments; headings, items and checkboxes marked", () => {
    const text = [
      ":PROPERTIES:", ":ID: x", ":END:", "#+title: T", "", "", "First line", "", "", "", "* TODO Heading :tag:", "SCHEDULED: <2026-01-01>",
      ":LOGBOOK:", "- note", ":END:", "# a comment", "- item", "  - [ ] open", "  - [X] done", "1. numbered", "#+begin_src sh", "ls", "#+end_src",
    ].join("\n");
    expect(previewLines(text).lines).toEqual([
      { kind: "text", text: "First line", depth: 0 },
      { kind: "text", text: "", depth: 0 },
      { kind: "heading", text: "TODO Heading", depth: 0 },
      { kind: "item", text: "item", depth: 0 },
      { kind: "check", text: "open", depth: 1 },
      { kind: "checked", text: "done", depth: 1 },
      { kind: "item", text: "numbered", depth: 0 },
      { kind: "text", text: "ls", depth: 0 },
    ]);
    expect(previewLines(text).more).toBe(false);
    const long = previewLines(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
    expect(long.lines).toHaveLength(12);
    expect(long.more).toBe(true);
    expect(previewLines("").lines).toEqual([]);
  });

  test("pinned cards come first, then the most recently changed", () => {
    const cards = [card("a.org", "#+title: A", 1), card("b.org", "#+title: B", 3), card("c.org", "#+title: C\n#+pinned: t", 0), card("d.org", "#+title: D", 3)];
    expect(sortCards(cards).map((c) => c.title)).toEqual(["C", "B", "D", "A"]);
  });

  test("the grid hides the journal and chosen folders, narrows to any chosen chip, then by every word typed", () => {
    const cards = [
      card("notes/a.org", "#+title: Alpha\n#+filetags: :recipe:\nrice and dal"),
      card("notes/b.org", "#+title: Beta\n#+filetags: :travellog:\nbeach"),
      card("notes/c.org", "#+title: Gamma\nrice"),
      card("journal/2026/11/2026-11-10.org", "#+title: 2026-11-10\n#+filetags: :journal:recipe:"),
      card("topics/rice.org", "#+title: Rice"),
    ];
    const hidden = ["journal", "topics/"];
    const titles = (f = NO_GRID_FILTER) => filterCards(cards, f, hidden).map((c) => c.title);
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(titles({ ...NO_GRID_FILTER, tags: ["recipe"] })).toEqual(["Alpha"]);
    expect(titles({ ...NO_GRID_FILTER, tags: ["recipe", "travellog"] })).toEqual(["Alpha", "Beta"]);
    expect(titles({ ...NO_GRID_FILTER, folders: ["journal"] })).toEqual(["2026-11-10"]);
    expect(titles({ ...NO_GRID_FILTER, folders: ["topics"], tags: ["travellog"] })).toEqual(["Beta", "Rice"]);
    expect(titles({ ...NO_GRID_FILTER, text: "RICE" })).toEqual(["Alpha", "Gamma"]);
    expect(titles({ ...NO_GRID_FILTER, text: "rice dal" })).toEqual(["Alpha"]);
    // labels count the cards outside the hidden folders, most first
    expect(gridLabels(cards, hidden)).toEqual([{ tag: "recipe", count: 1 }, { tag: "travellog", count: 1 }]);
    expect(cleanGridFilter({ text: 3, tags: ["a", 2, "a"], folders: "x" })).toEqual({ text: "", tags: ["a"], folders: [] });
    expect(cleanGridFilter(null)).toEqual(NO_GRID_FILTER);
  });

  test("cards fill the shortest column in order; two columns on a phone, up to six", () => {
    expect(masonry([5, 2, 2, 3, 1], 2)).toEqual([[0, 4], [1, 2, 3]]);
    expect(masonry([1, 1, 1], 3)).toEqual([[0], [1], [2]]);
    expect([gridColumns(360), gridColumns(100), gridColumns(800), gridColumns(1100), gridColumns(3000)]).toEqual([2, 2, 3, 5, 6]);
    expect(cardLines(card("a.org", "#+title: A\none\ntwo"))).toBe(4);
  });

  test("pin, colour and labels are written as #+ lines, replacing, adding or removing them", () => {
    const set = setKeyword(NOTE, "color", "teal");
    expect(set).toContain("#+color: teal");
    expect(set).not.toContain("Yellow");
    expect(setKeyword(NOTE, "pinned", null)).not.toContain("#+pinned");
    // a new line goes after the last #+ line, else after the leading drawer, else at the top
    expect(setKeyword("#+title: T\n\nBody", "pinned", "t")).toBe("#+title: T\n#+pinned: t\n\nBody");
    expect(setKeyword(":PROPERTIES:\n:ID: x\n:END:\nBody", "color", "red")).toBe(":PROPERTIES:\n:ID: x\n:END:\n#+color: red\nBody");
    expect(setKeyword("Body\n* H\n#+color: red", "color", "blue")).toBe("#+color: blue\nBody\n* H\n#+color: red");
    expect(setKeyword("Body", "color", null)).toBe("Body");
    // the key keeps how it was written; duplicates go
    expect(setKeyword("#+COLOR: red\n#+color: blue", "color", "pink")).toBe("#+COLOR: pink");
    expect(setFileTags(NOTE, ["travellog", "hawaii", "beach", "beach"])).toContain("#+filetags: :travellog:hawaii:beach:");
    expect(setFileTags(NOTE, [])).not.toContain("#+filetags");
    expect([cleanLabel(" day trip "), cleanLabel(":x:"), cleanLabel("a/b"), cleanLabel("")]).toEqual(["day_trip", "x", null, null]);
  });
});
