import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  denoteDate, denoteFileName, DenoteFiles, denoteFrontMatter, denoteIdOf, denoteLabel, denoteTabTitle, parseDenoteLink, slugKeyword, slugTitle, timestampId,
} from "../src/org/denote";
import { classifyLink } from "../src/org/syntax";
import { backlinksTo, mentionLink, noteLinkTarget, readNote, searchOffset, titleCompletions } from "../src/org/vault-index";
import { noteCaptureText } from "../src/org/capture";
import { denoteJournalContent, journalEntries, journalPathForDate } from "../src/org/journal";
import { notePath } from "../src/org/new-note";
import { assignId, insertIdLink } from "../src/org/edit";

describe("Denote", () => {
  test("Denote file names give their identifier; other names don't", () => {
    expect(denoteIdOf("notes/20261026T210500--my-note__a_b.org")).toBe("20261026T210500");
    expect(denoteIdOf("2610a--trip.org")).toBe("2610a");
    expect(denoteIdOf("@@2610a--trip.org")).toBe("2610a");
    expect(denoteIdOf("@@2610d.m4a")).toBe("2610d");
    expect(denoteIdOf("attachments/2610c--beach.jpg")).toBe("2610c");
    expect(denoteIdOf("journal/2026/10/261003--2026-10-03__journal.org")).toBe("261003");
    expect(denoteIdOf("2610q__keyword.png")).toBe("2610q");
    expect(denoteIdOf("x/2610b==1a--title.org")).toBe("2610b");
    expect(denoteIdOf("--title@@2610e__k.org")).toBe("2610e");
    for (const plain of ["index.org", "README.org", "2610-last-plan.org", "Rec-30--voice-note.m4a", "PXL_2026_1.webp", "2026-10-03.org", "Some Note.org"]) {
      expect(denoteIdOf(plain)).toBeNull();
    }
  });

  test("a file with a Denote name reads as its title in lists, or its identifier without one", () => {
    expect(denoteLabel("attachments/@@2610o--pxl-20261021-010451957.webp")).toBe("pxl 20261021 010451957");
    expect(denoteLabel("topics/@@2609dy--hikes__outdoor.org")).toBe("hikes");
    expect(denoteLabel("20261026T210500--my-note__a_b.org")).toBe("my note");
    expect(denoteLabel("--title@@2610e__k.org")).toBe("title");
    expect(denoteLabel("@@2610d.m4a")).toBe("2610d");
    expect(denoteLabel("@@2610d__voice.m4a")).toBe("2610d");
    expect(denoteLabel("index.org")).toBeNull();
  });

  test("a Denote tab shows the note's title, else the title in the name", () => {
    expect(denoteTabTitle("notes/@@2610d--goa-trip__travel.org", "Goa trip")).toBe("Goa trip");
    // the index falls back to the file name when there's no #+title
    expect(denoteTabTitle("notes/@@2610d--goa-trip__travel.org", "@@2610d--goa-trip__travel")).toBe("goa trip");
    expect(denoteTabTitle("attachments/@@2610o--pxl-20261021.webp")).toBe("pxl 20261021");
    expect(denoteTabTitle("@@2610d.m4a")).toBe("2610d");
    expect(denoteTabTitle("tasks.org", "Tasks")).toBeNull();
  });

  test("denote links name an identifier and a search", () => {
    expect(parseDenoteLink("denote:2610a")).toEqual({ id: "2610a", search: "" });
    expect(parseDenoteLink("denote:2610a::#dani")).toEqual({ id: "2610a", search: "#dani" });
    expect(parseDenoteLink("denote:2610a::*A heading")).toEqual({ id: "2610a", search: "*A heading" });
    expect(parseDenoteLink("id:2610a")).toBeNull();
    expect(classifyLink("denote:2610a::#dani")).toEqual({ kind: "denote", id: "2610a", search: "#dani" });
    expect(noteLinkTarget("denote:2610a::#dani")).toBe("2610a");
  });

  test("Denote names, front matter and timestamp identifiers", () => {
    // as denote-sluggify-title: punctuation dropped, not turned into "-"; accents kept
    expect(slugTitle("  Café: plans, 2026!  ")).toBe("café-plans-2026");
    expect(slugTitle("Tom's notes_on  Dr. Who")).toBe("toms-notes-on-dr-who");
    expect(slugKeyword("Org-Mode_x y")).toBe("orgmodexy");
    expect(denoteFileName("2610a", "Trip to Goa", ["Travel", "family"], "org")).toBe("@@2610a--trip-to-goa__travel_family.org");
    expect(denoteFileName("2610c", "Pasted image 20261026", [], "png")).toBe("@@2610c--pasted-image-20261026.png");
    expect(denoteFileName("2610d", "", [], "m4a")).toBe("@@2610d.m4a");
    // Denote's own date identifiers are written without @@
    expect(denoteFileName("20261026T210509", "Trip", [], "org")).toBe("20261026T210509--trip.org");
    const at = new Date(2026, 9, 26, 21, 5, 9);
    expect(denoteDate(at)).toBe("[2026-10-26 Mon 21:05]");
    expect(denoteFrontMatter("Trip to Goa", at, ["travel"], "2610a")).toBe(
      "#+title:      Trip to Goa\n#+date:       [2026-10-26 Mon 21:05]\n#+filetags:   :travel:\n#+identifier: 2610a\n\n");
    expect(denoteFrontMatter("T", at, [], "x")).not.toContain("filetags");
    expect(timestampId(at, new Set())).toBe("20261026T210509");
    expect(timestampId(at, new Set(["20261026T210509", "20261026T210510"]))).toBe("20261026T210511");
  });

  test("DenoteFiles finds files by identifier, through renames and deletes", () => {
    const files = new DenoteFiles(["notes/2610a--trip.org", "attachments/2610c--beach.jpg", "index.org"]);
    expect(files.path("2610c")).toBe("attachments/2610c--beach.jpg");
    expect(files.path("index")).toBeNull();
    files.rename("attachments/2610c--beach.jpg", "media/2610c--goa-beach.jpg");
    expect(files.path("2610c")).toBe("media/2610c--goa-beach.jpg");
    files.remove("notes/2610a--trip.org");
    expect(files.path("2610a")).toBeNull();
    expect([...files.ids()]).toEqual(["2610c"]);
    // two files with one identifier: the first path wins, the other takes over when it goes
    files.add("b/2610c--x.jpg");
    expect(files.path("2610c")).toBe("b/2610c--x.jpg");
    files.remove("b/2610c--x.jpg");
    expect(files.entries()).toEqual([{ id: "2610c", path: "media/2610c--goa-beach.jpg" }]);
  });

  test("the index reads a Denote note's identifier and CUSTOM_IDs, links them by title and finds searches", () => {
    const people = readNote("2610p--people.org", [
      "#+title:      people",
      "#+identifier: 2610p",
      "* Dani :friend:",
      ":PROPERTIES:",
      ":CUSTOM_ID: dani",
      ":END:",
      "* DONE Plan",
    ].join("\n"), { todo: ["TODO"], done: ["DONE"] });
    expect(people.denoteId).toBe("2610p");
    expect(people.customIds).toEqual([{ id: "dani", offset: people.text.indexOf("* Dani"), heading: "Dani" }]);
    expect(titleCompletions([people], "denote")).toEqual([
      { label: "people", detail: undefined, id: "2610p", target: "denote:2610p" },
      { label: "Dani", detail: "people", id: "2610p::#dani", target: "denote:2610p::#dani" },
    ]);
    // a note without a Denote name isn't offered
    expect(titleCompletions([readNote("index.org", ":PROPERTIES:\n:ID: x\n:END:\n")], "denote")).toEqual([]);
    expect(searchOffset(people, "#dani")).toBe(people.text.indexOf("* Dani"));
    expect(searchOffset(people, "*Plan")).toBe(people.text.indexOf("* DONE Plan"));
    expect(searchOffset(people, "#nobody")).toBeNull();
    // links by identifier, with or without a search, are backlinks
    const day = readNote("journal/261003--2026-10-03__journal.org", "Met [[denote:2610p::#dani][Dani]]\n");
    expect(backlinksTo(people, [people, day]).map((b) => b.path)).toEqual([day.path]);
    expect(mentionLink(people, "the people", "denote")).toBe("[[denote:2610p][the people]]");
    expect(noteCaptureText(people, "denote")).toBe("\n[[denote:2610p][people]]");
  });

  test("Denote notes and journal days are named by identifier, and days found by date", () => {
    expect(notePath("notes", " Trip to Goa ", "2610a")).toBe("notes/@@2610a--trip-to-goa.org");
    const d = new Date(2026, 9, 3, 8, 30);
    expect(journalPathForDate("journal", d, "261003")).toBe("journal/2026/10/@@261003--2026-10-03__journal.org");
    expect(denoteJournalContent(d, "261003", d)).toBe(
      "#+title:      2026-10-03\n#+date:       [2026-10-03 Sat 08:30]\n#+filetags:   :journal:\n#+identifier: 261003\n\n");
    expect(journalEntries(["journal/2026/10/@@261003--2026-10-03__journal.org", "journal/2026/10/2026-10-02.org", "notes/2610a--x.org"], "journal"))
      .toEqual([
        { path: "journal/2026/10/@@261003--2026-10-03__journal.org", date: "2026-10-03" },
        { path: "journal/2026/10/2026-10-02.org", date: "2026-10-02" },
      ]);
  });

  test("with Denote, a heading gets a CUSTOM_ID and the ID link command inserts denote:", () => {
    const at = (doc: string, pos: number) => EditorState.create({ doc, selection: EditorSelection.cursor(pos) });
    const s = at("#+title: x\n* Dani\ntext", 15);
    const spec = assignId(s, "h:1-2", undefined, "CUSTOM_ID")!;
    expect(s.update(spec).state.doc.toString()).toBe("#+title: x\n* Dani\n:PROPERTIES:\n:CUSTOM_ID: h:1-2\n:END:\ntext");
    // the file itself is named by its identifier
    expect(assignId(at("#+title: x\n", 0), "h:1", undefined, "CUSTOM_ID")).toBeNull();
    const e = at("see ", 4);
    const link = e.update(insertIdLink(e, "denote")).state;
    expect(link.doc.toString()).toBe("see [[denote:]]");
    expect(link.selection.main.head).toBe(13);
  });
});
