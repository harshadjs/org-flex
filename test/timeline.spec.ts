import { describe, expect, test } from "vitest";
import { buildTimeline, cleanFilter, filterTimeline, idTime, NO_FILTER, timelineTags, untilEnd } from "../src/org/timeline";
import { readNote } from "../src/org/vault-index";

const created = () => new Date(2020, 0, 1, 12, 0);

describe("timeline", () => {
  test("ID times: ts style and microseconds parse, anything else has none", () => {
    expect(idTime("20261029T143012.123456")).toEqual(new Date(2026, 9, 29, 14, 30, 12, 123));
    expect(idTime("20261029T143012")).toEqual(new Date(2026, 9, 29, 14, 30, 12));
    expect(idTime(String(new Date(2026, 9, 27, 8, 0).getTime() * 1000 + 5))).toEqual(new Date(2026, 9, 27, 8, 0));
    expect(idTime("6f1c2a9e-4b7d-4c2a-9a10-2b5e6d7f8a90")).toBeNull();
    expect(idTime("2610-some-note")).toBeNull();
  });

  test("the timeline lists every ID newest first by its time, grouped by day, headings with their note's title, journal days marked", () => {
    const notes = [
      readNote("journal/2026/10/2026-10-28.org", ":PROPERTIES:\n:ID: 20261028T080000.000000\n:END:\n#+title: 2026-10-28\n* Walk\n:PROPERTIES:\n:ID: 20261028T190000.000000\n:END:\n"),
      readNote("notes/2610-roti.org", ":PROPERTIES:\n:ID: 20261029T090000.000000\n:END:\n#+title: Roti\n* TODO [[id:x][Fix]] C :home:\n:PROPERTIES:\n:ID: 20261028T080000.000001\n:END:\n"),
      readNote("notes/old.org", ":PROPERTIES:\n:ID: 0f3c9a1e-4b7d-4c2a-9a10-2b5e6d7f8a90\n:END:\n#+title: Old\n"),
      readNote("notes/plain.org", "* no IDs here\n"),
    ];
    const { days } = buildTimeline(notes, [], created, new Set(["journal/2026/10/2026-10-28.org"]));
    expect(days.flatMap((d) => d.entries.map((e) => e.kind))).toEqual(["note", "heading", "journal", "heading", "note"]);
    expect(days.map((d) => [d.date, d.entries.map((e) => [e.title, e.note, e.line])])).toEqual([
      [new Date(2026, 9, 29), [["Roti", undefined, 0]]],
      [new Date(2026, 9, 28), [["Walk", "2026-10-28", 4], ["2026-10-28", undefined, 0], ["Fix C", "Roti", 4]]],
      [new Date(2020, 0, 1), [["Old", undefined, 0]]],
    ]);
  });

  test("an attachment sits under the closest node that links it, the earliest when several do; the rest are unlinked", () => {
    const notes = [
      readNote("journal/2026/10/2026-10-28.org", [
        ":PROPERTIES:", ":ID: 20261028T080000", ":END:", "#+title: 2026-10-28",
        "[[file:../../../attachments/2610-voice-note-01.webm]]",
        "* Garden", ":PROPERTIES:", ":ID: 20261028T100000", ":END:",
        "** Notes without an ID", "[[file:../../../attachments/2610-pasted-image-01.png]]",
        "* Later, no ID", "[[file:../../../attachments/2610-pasted-image-02.png]]",
        "[[file:../../../attachments/notes.txt]]",
      ].join("\n")),
      readNote("notes/2610-garden.org", ":PROPERTIES:\n:ID: 20261029T080000\n:END:\n[[file:../attachments/2610-pasted-image-01.png]]\n[[file:../attachments/2610-pasted-image-03.png]]\n[[file:../attachments/2610-walk.ogv]]"),
      readNote("notes/no-id.org", "[[file:../attachments/2609-pasted-image-09.png]]"),
    ];
    const files = ["attachments/2610-voice-note-01.webm", "attachments/2610-pasted-image-01.png", "attachments/2610-pasted-image-02.png",
      "attachments/2610-pasted-image-03.png", "attachments/2609-pasted-image-09.png", "attachments/2611-unused.pdf", "attachments/notes.txt", "notes/2610-garden.org", "attachments/2610-walk.ogv", "attachments/2608-clip.mov"];
    const { days, unlinked } = buildTimeline(notes, files, created);
    const under = Object.fromEntries(days.flatMap((d) => d.entries).map((e) => [e.title, e.attachments]));
    expect(under).toEqual({
      "2610-garden": ["attachments/2610-pasted-image-03.png", "attachments/2610-walk.ogv"],
      Garden: ["attachments/2610-pasted-image-01.png"],
      "2026-10-28": ["attachments/2610-pasted-image-02.png", "attachments/2610-voice-note-01.webm"],
    });
    expect(unlinked).toEqual(["attachments/2611-unused.pdf", "attachments/2609-pasted-image-09.png", "attachments/2608-clip.mov"]);
  });
});

describe("timeline filters", () => {
  const notes = [
    readNote("journal/2026/10/2026-10-28.org", ":PROPERTIES:\n:ID: 20261028T080000\n:END:\n#+title: 2026-10-28\n[[file:../../../attachments/2610-voice-note-01.webm]]\n* Garden walk\n:PROPERTIES:\n:ID: 20261028T100000\n:END:\n"),
    readNote("notes/2610-roti.org", ":PROPERTIES:\n:ID: 20261027T090000\n:END:\n#+title: Roti machine\n"),
  ];
  const files = ["attachments/2610-voice-note-01.webm", "attachments/2610-garden.png"];
  const tl = buildTimeline(notes, files, created, new Set(["journal/2026/10/2026-10-28.org"]));
  const titles = (t: ReturnType<typeof filterTimeline>) => t.days.flatMap((d) => d.entries.map((e) => e.title));

  test("filters keep entries of the chosen kinds, with attachments, or matching the text; days left empty go", () => {
    expect(titles(filterTimeline(tl, NO_FILTER))).toEqual(["Garden walk", "2026-10-28", "Roti machine"]);
    expect(filterTimeline(tl, NO_FILTER).unlinked).toEqual(["attachments/2610-garden.png"]);
    const notesOnly = filterTimeline(tl, { ...NO_FILTER, kinds: ["note"] });
    expect([titles(notesOnly), notesOnly.days.length, notesOnly.unlinked]).toEqual([["Roti machine"], 1, []]);
    expect(titles(filterTimeline(tl, { ...NO_FILTER, attachments: true }))).toEqual(["2026-10-28"]);
    // every word, in the title, the note's title or an attachment's name, ignoring case
    expect(titles(filterTimeline(tl, { ...NO_FILTER, text: "VOICE" }))).toEqual(["2026-10-28"]);
    expect(titles(filterTimeline(tl, { ...NO_FILTER, text: "walk 2026" }))).toEqual(["Garden walk"]);
    expect(filterTimeline(tl, { ...NO_FILTER, text: "garden" }).unlinked).toEqual(["attachments/2610-garden.png"]);
    expect(filterTimeline(tl, { ...NO_FILTER, text: "nothing" })).toEqual({ days: [], unlinked: [] });
  });

  test("a saved filter is cleaned: unknown kinds dropped, anything missing shows everything", () => {
    expect(cleanFilter(null)).toEqual(NO_FILTER);
    expect(cleanFilter({ kinds: ["heading", "bogus"], attachments: "yes", text: 3 })).toEqual({ kinds: ["heading"], attachments: false, text: "", tags: [], until: "" });
    expect(cleanFilter({ tags: ["book", 4, "", "book", "recipe"] }).tags).toEqual(["book", "recipe"]);
    expect(cleanFilter({ until: "2026-10-28" }).until).toBe("2026-10-28");
    expect(cleanFilter({ until: "2026-02-30" }).until).toBe("");
    expect(cleanFilter({ until: 20261028 }).until).toBe("");
  });

  test("tags: a note's filetags, a heading's own, and those it inherits; the filter keeps entries carrying every chosen tag", () => {
    const notes = [
      readNote("notes/2610-food.org", [
        ":PROPERTIES:", ":ID: 20261029T090000", ":END:", "#+title: Food", "#+filetags: :recipe:home:",
        "* Breads :baking:", ":PROPERTIES:", ":ID: 20261029T100000", ":END:",
        "** Sibling :other:",
        "** TODO [#A] Roti :quick:home:", ":PROPERTIES:", ":ID: 20261029T110000", ":END:",
        "* Soups", ":PROPERTIES:", ":ID: 20261029T120000", ":END:",
      ].join("\n")),
      readNote("notes/2610-plain.org", ":PROPERTIES:\n:ID: 20261028T090000\n:END:\n#+title: Plain\n"),
    ];
    const tl = buildTimeline(notes, ["attachments/x.png"], created);
    const tags = Object.fromEntries(tl.days.flatMap((d) => d.entries.map((e) => [e.title, [e.tags, e.inherited]])));
    expect(tags).toEqual({
      Food: [["recipe", "home"], []],
      Breads: [["baking"], ["recipe", "home"]],
      Roti: [["quick", "home"], ["recipe", "baking"]],
      Soups: [[], ["recipe", "home"]],
      Plain: [[], []],
    });
    const titles = (f: Partial<typeof NO_FILTER>) => filterTimeline(tl, { ...NO_FILTER, ...f }).days.flatMap((d) => d.entries.map((e) => e.title));
    expect(titles({ tags: ["baking"] })).toEqual(["Roti", "Breads"]);
    expect(titles({ tags: ["baking", "quick"] })).toEqual(["Roti"]);
    expect(titles({ tags: ["other"] })).toEqual([]);
    expect(titles({ text: "recipe" })).toEqual(["Soups", "Roti", "Breads", "Food"]);
    expect(filterTimeline(tl, { ...NO_FILTER, tags: ["home"] }).unlinked).toEqual([]);
    expect(timelineTags(tl)).toEqual([
      { tag: "home", count: 4 }, { tag: "recipe", count: 4 }, { tag: "baking", count: 2 }, { tag: "quick", count: 1 },
    ]);
    expect(timelineTags(filterTimeline(tl, { ...NO_FILTER, tags: ["quick"] }), ["quick", "gone"])).toEqual([
      { tag: "quick", count: 1 }, { tag: "gone", count: 0 }, { tag: "baking", count: 1 }, { tag: "home", count: 1 }, { tag: "recipe", count: 1 },
    ]);
  });

  test("until a date: entries on or before that day, to its end; unlinked files go", () => {
    expect(untilEnd("2026-10-28")).toEqual(new Date(2026, 9, 29));
    expect(untilEnd("2026-13-01")).toBeNull();
    expect(untilEnd("")).toBeNull();
    const notes = [
      readNote("notes/a.org", ":PROPERTIES:\n:ID: 20261029T000000\n:END:\n#+title: Thursday midnight\n"),
      readNote("notes/b.org", ":PROPERTIES:\n:ID: 20261028T235959.999999\n:END:\n#+title: Wednesday late\n"),
      readNote("notes/c.org", ":PROPERTIES:\n:ID: 20261027T080000\n:END:\n#+title: Tuesday\n"),
    ];
    const tl = buildTimeline(notes, ["attachments/x.png"], created);
    const until = (d: string) => filterTimeline(tl, { ...NO_FILTER, until: d });
    expect(until("2026-10-28").days.flatMap((d) => d.entries.map((e) => e.title))).toEqual(["Wednesday late", "Tuesday"]);
    expect(until("2026-10-28").unlinked).toEqual([]);
    expect(until("2026-10-26").days).toEqual([]);
    expect(until("").days.length).toBe(3);
    expect(until("").unlinked).toEqual(["attachments/x.png"]);
  });
});
