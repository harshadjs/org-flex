import { describe, expect, test } from "vitest";
import { buildTimeline, idTime } from "../src/org/timeline";
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
      readNote("notes/2610-garden.org", ":PROPERTIES:\n:ID: 20261029T080000\n:END:\n[[file:../attachments/2610-pasted-image-01.png]]\n[[file:../attachments/2610-pasted-image-03.png]]"),
      readNote("notes/no-id.org", "[[file:../attachments/2609-pasted-image-09.png]]"),
    ];
    const files = ["attachments/2610-voice-note-01.webm", "attachments/2610-pasted-image-01.png", "attachments/2610-pasted-image-02.png",
      "attachments/2610-pasted-image-03.png", "attachments/2609-pasted-image-09.png", "attachments/2611-unused.pdf", "attachments/notes.txt", "notes/2610-garden.org"];
    const { days, unlinked } = buildTimeline(notes, files, created);
    const under = Object.fromEntries(days.flatMap((d) => d.entries).map((e) => [e.title, e.attachments]));
    expect(under).toEqual({
      "2610-garden": ["attachments/2610-pasted-image-03.png"],
      Garden: ["attachments/2610-pasted-image-01.png"],
      "2026-10-28": ["attachments/2610-pasted-image-02.png", "attachments/2610-voice-note-01.webm"],
    });
    expect(unlinked).toEqual(["attachments/2611-unused.pdf", "attachments/2609-pasted-image-09.png"]);
  });
});
