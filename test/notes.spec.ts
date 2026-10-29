import { describe, expect, test } from "vitest";
import { orgConflictMessage } from "../src/conflicts";
import { FLAVOUR } from "../src/flavour";
import { Text } from "@codemirror/state";
import { analyze } from "../src/org/syntax";
import { foldAt, nextVisibility, visibilityFolds } from "../src/org/folding";
import { displayValue, parseFrontMatter, propertyIcon, simplifyValue } from "../src/org/front-matter";
import {
  calendarMonth, journalDateString, journalEntries, journalEntryLabel, journalFileContent, DEFAULT_JOURNAL_TEMPLATE, journalPathForDate,
} from "../src/org/journal";
import { readNote } from "../src/org/vault-index";
import { addDays, appendEntry, captureEntry, capturePath, captureStates, dateFieldValue, noteCaptureText, parseDateField, sharedCaptureText } from "../src/org/capture";
import { freeNotePath, noteFileName, notePath, noteFileContent, titleProblem } from "../src/org/new-note";
import {
  barButtons, BUTTONS, buttonIconName, mergeSettings, migrateShortcutButtons, moveButton, toggleButton, DEFAULT_SETTINGS,
} from "../src/settings";

function folds(lines: string[]) {
  const doc = Text.of(lines);
  const structure = analyze(lines);
  const at = (n: number, lockedDrawer: number | null = null) => {
    const r = foldAt(doc, structure, n, { lockedDrawer });
    return r && doc.sliceString(r.from, r.to);
  };
  return { doc, structure, at };
}

describe("folding", () => {
  test("a heading alone doesn't fold", () => {
    expect(folds(["* a", "* b"]).at(0)).toBeNull();
    expect(folds(["* a", "", "* b"]).at(0)).toBeNull();
  });

  test("heading and section fold, without the final newline", () => {
    expect(folds(["* a", "text", "more", "* b"]).at(0)).toBe("\ntext\nmore");
  });

  test("nested headings fold up to a heading of the same or higher level", () => {
    const f = folds(["* a", "** b", "x", "*** c", "** d", "* e"]);
    expect(f.at(0)).toBe("\n** b\nx\n*** c\n** d");
    expect(f.at(1)).toBe("\nx\n*** c");
  });

  test("the zeroth section doesn't fold", () => {
    expect(folds(["intro", "* a"]).at(0)).toBeNull();
  });

  test("property drawers and blocks fold from their first line", () => {
    const f = folds([":PROPERTIES:", ":ID: x", ":END:", "#+begin_src js", "1", "#+end_src"]);
    expect(f.at(0)).toBe("\n:ID: x\n:END:");
    expect(f.at(3)).toBe("\n1\n#+end_src");
    // FOLD-7: the front matter drawer is locked while the panel is on
    expect(f.at(0, 0)).toBeNull();
  });

  test("nextVisibility goes fold all, outline, expand all and back", () => {
    expect(nextVisibility("foldall")).toBe("outline");
    expect(nextVisibility("outline")).toBe("expandall");
    expect(nextVisibility("expandall")).toBe("foldall");
  });

  test("visibility cycling: fold all, outline, expand all", () => {
    const lines = ["* a", ":PROPERTIES:", ":ID: a", ":END:", "text a", "** b", "text b", "* c", "text c"];
    const { doc, structure } = folds(lines);
    const show = (level: "foldall" | "outline" | "expandall", drawers: boolean) =>
      visibilityFolds(doc, structure, level, drawers, { lockedDrawer: null }).map((r) => [doc.lineAt(r.from).number, doc.lineAt(r.to).number]);
    expect(show("foldall", false)).toEqual([[1, 7], [8, 9]]);
    expect(show("outline", false)).toEqual([[1, 5], [6, 7], [8, 9]]);
    expect(show("expandall", false)).toEqual([]);
    expect(show("expandall", true)).toEqual([[2, 4]]);
    expect(show("outline", true)).toEqual([[1, 5], [2, 4], [6, 7], [8, 9]]);
  });
});

describe("front matter", () => {
  test("parseFrontMatter reads the drawer and keyword lines", () => {
    const fm = parseFrontMatter([":PROPERTIES:", ":ID:       x", ":END:", "#+title: Hello", "#+filetags: :a:b:", "", "body"])!;
    expect(fm.drawerLine).toBe(0);
    expect(fm.endLine).toBe(4);
    expect(fm.title).toMatchObject({ key: "title", value: "Hello", line: 3 });
    expect(fm.entries.map((e) => [e.key, e.value, e.source])).toEqual([["ID", "x", "drawer"], ["filetags", ":a:b:", "keyword"]]);
  });

  test("parseFrontMatter: keywords only, none, unterminated drawers and affiliated keywords", () => {
    expect(parseFrontMatter(["#+title: T", "#+name: tbl", "| a |"])!.endLine).toBe(0);
    expect(parseFrontMatter(["text", "#+title: T"])).toBeNull();
    expect(parseFrontMatter([":PROPERTIES:", ":ID: x", "* heading"])).toBeNull();
    expect(parseFrontMatter(["#+begin_src js"])).toBeNull();
  });

  test("values: tags and aliases become pills, links and dates are simplified", () => {
    expect(displayValue("filetags", ":journal:work:")).toEqual({ kind: "pills", items: ["journal", "work"] });
    expect(displayValue("ROAM_ALIASES", 'one "two words"')).toEqual({ kind: "pills", items: ["one", "two words"] });
    expect(displayValue("source", "[[https://x.y][The site]]")).toEqual({ kind: "text", text: "The site" });
    expect(simplifyValue("<2024-01-02 Tue>")).toBe("2024-01-02 Tue");
    expect(displayValue("x", "  ")).toEqual({ kind: "empty" });
    expect(propertyIcon("ID", "x")).toBe("fingerprint");
    expect(propertyIcon("created", "[2024-01-02 Tue]")).toBe("calendar");
  });
});

describe("journal", () => {
  const d = new Date(2024, 2, 5);

  test("journalDateString zero-pads month and day in local time", () => {
    expect(journalDateString(d)).toBe("2024-03-05");
  });

  test("journalPathForDate nests by year and month, tolerating slashes and an empty folder", () => {
    expect(journalPathForDate("journal", d)).toBe("journal/2024/03/2024-03-05.org");
    expect(journalPathForDate("/a/b/", d)).toBe("a/b/2024/03/2024-03-05.org");
    expect(journalPathForDate("", d)).toBe("2024/03/2024-03-05.org");
  });

  test("journalFileContent fills the template's date and ID", () => {
    expect(journalFileContent(d, DEFAULT_JOURNAL_TEMPLATE, "u-1")).toBe(":PROPERTIES:\n:ID:       u-1\n:END:\n#+title: 2024-03-05\n\n");
    expect(journalFileContent(d, ":ID: {{date}}\n#+filetags: :journal:\n", "u-1")).toBe(":ID: 2024-03-05\n#+filetags: :journal:\n");
    expect(journalFileContent(d, "* {{ DATE }} {{date}}\n", "x")).toBe("* 2024-03-05 2024-03-05\n");
  });

  test("this flavour has TODO IN-PROGRESS WAITING then DONE CANCELLED, org-roam links, microsecond IDs, counted voice notes and CLOSED logging", () => {
    expect([FLAVOUR.todoKeywords, FLAVOUR.doneKeywords]).toEqual([["TODO", "IN-PROGRESS", "WAITING"], ["DONE", "CANCELLED"]]);
    expect(FLAVOUR.logDone).toBe(true);
    expect(FLAVOUR.journalTemplate).toBe(DEFAULT_JOURNAL_TEMPLATE);
    expect(FLAVOUR.links).toBe("id");
    expect(FLAVOUR.orgId(1793101200123456, new Set())).toBe("1793101200123456");
    expect(FLAVOUR.orgId(1793101200123456, new Set(["1793101200123456"]))).toBe("1793101200123457");
    expect(FLAVOUR.mediaName("recording", new Date(2026, 9, 27), "m4a", new Set(["2610-voice-note-03.mp3"]))).toBe("2610-voice-note-04.m4a");
    expect(FLAVOUR.mediaName("image", new Date(2026, 9, 27), "png", new Set())).toBe("2610-pasted-image-01.png");
  });

  test("journalEntries keeps dated files under the folder, newest first", () => {
    expect(journalEntries([
      "journal/2024/01/2024-01-02.org", "journal/2023-12-31.org", "other/2024-05-05.org",
      "journal/notes.org", "journal/2024/01/2024-01-03.md",
    ], "journal").map((e) => e.date)).toEqual(["2024-01-02", "2023-12-31"]);
  });

  test("journal entries are labelled with weekday and month", () => {
    expect(journalEntryLabel("2024-03-05", "en-US")).toBe("2024-03-05 · Tuesday, March 5");
  });

  test("calendarMonth lays a month out in full weeks from the first weekday", () => {
    const weeks = calendarMonth(2024, 1, 1); // February 2024, Monday first
    expect(weeks.length).toBe(5);
    expect(weeks[0][0]).toEqual({ date: "2024-01-29", day: 29, inMonth: false });
    expect(weeks[0][3]).toEqual({ date: "2024-02-01", day: 1, inMonth: true });
    expect(weeks[4][6]).toEqual({ date: "2024-03-03", day: 3, inMonth: false });
    expect(calendarMonth(2024, 1, 0)[0][0].date).toBe("2024-01-28");
  });
});

describe("new notes", () => {
  test("titleProblem accepts ordinary titles, spaces included", () => {
    expect(titleProblem("My Note")).toBeNull();
    expect(titleProblem("Chris-Evans")).toBeNull();
  });

  test("titleProblem rejects empty titles and characters that break files or links", () => {
    expect(titleProblem("  ")).not.toBeNull();
    for (const bad of ["a/b", "a:b", "a#b", "a[b", "a|b", "a^b", ".hidden", "end."]) {
      expect(titleProblem(bad)).not.toBeNull();
    }
  });

  test("notePath puts the trimmed title in the folder", () => {
    expect(notePath("notes", "  My Note ")).toBe("notes/My Note.org");
    expect(notePath("", "x")).toBe("x.org");
  });

  test("a note created from the link list gets a clean file name that isn't taken yet", () => {
    expect(noteFileName(" A/B: c ")).toBe("A-B- c");
    expect(noteFileName("...dots.")).toBe("dots");
    expect(noteFileName("[[]]")).toBe("----");
    expect(noteFileName("..")).toBe("Untitled");
    const taken = new Set(["Idea.org", "Idea 2.org"]);
    expect(freeNotePath("", "Idea", (p) => taken.has(p))).toBe("Idea 3.org");
    expect(freeNotePath("", "Other", (p) => taken.has(p))).toBe("Other.org");
  });

  test("noteFileContent uses the UUID as ID and the title as #+title", () => {
    expect(noteFileContent(" My Note ", "0b6e1c3a-1f2d-4c5e-9a8b-7c6d5e4f3a2b"))
      .toBe(":PROPERTIES:\n:ID:       0b6e1c3a-1f2d-4c5e-9a8b-7c6d5e4f3a2b\n:END:\n#+title: My Note\n\n");
  });
});

describe("capture", () => {
  const day = new Date(2026, 9, 23, 10, 12);

  test("capturePath trims slashes, adds .org and falls back to inbox.org", () => {
    expect(capturePath("inbox.org")).toBe("inbox.org");
    expect(capturePath(" /notes/inbox/ ")).toBe("notes/inbox.org");
    expect(capturePath("")).toBe("inbox.org");
  });

  test("captureEntry makes a TODO scheduled today, later lines as its body", () => {
    expect(captureEntry("  Buy milk ", "TODO", day)).toBe("* TODO Buy milk\nSCHEDULED: <2026-10-23 Fri>\n");
    expect(captureEntry("\nCall Sam\r\n- about the trip\n  ask dates\n\n", "NEXT", day))
      .toBe("* NEXT Call Sam\nSCHEDULED: <2026-10-23 Fri>\n- about the trip\n  ask dates\n");
    expect(captureEntry(" \n\t\n", "TODO", day)).toBeNull();
  });

  test("captureEntry leaves out the keyword or the schedule when none is chosen", () => {
    expect(captureEntry("Read book", "", day)).toBe("* Read book\nSCHEDULED: <2026-10-23 Fri>\n");
    expect(captureEntry("Read book\nch. 3", "DONE", null)).toBe("* DONE Read book\nch. 3\n");
  });

  test("noteCaptureText links back to the note by its file ID, else by file name", () => {
    const withId = readNote("notes/Trip.org", ":PROPERTIES:\n:ID:       abc-123\n:END:\n#+title: Trip [plans]\n\n* H\n:PROPERTIES:\n:ID: h1\n:END:\n");
    expect(noteCaptureText(withId)).toBe("\n[[id:abc-123][Trip plans]]");
    expect(noteCaptureText(readNote("notes/Trip.org", "* H\n:PROPERTIES:\n:ID: h1\n:END:\n"))).toBe("\n[[Trip]]");
    expect(noteCaptureText(readNote("Trip.org", "#+title: Big trip\n"))).toBe("\n[[Trip][Big trip]]");
  });

  test("captureStates lists open then done keywords once each, then none", () => {
    expect(captureStates(["TODO", "NEXT"], ["DONE", "TODO"])).toEqual(["TODO", "NEXT", "DONE", ""]);
    expect(captureStates([], [])).toEqual([""]);
  });

  test("schedule dates go to and from a date field in local time", () => {
    expect(dateFieldValue(day)).toBe("2026-10-23");
    expect(dateFieldValue(addDays(day, 1))).toBe("2026-10-24");
    expect(dateFieldValue(addDays(new Date(2026, 11, 31, 23, 0), 1))).toBe("2027-01-01");
    expect(parseDateField("2026-02-03")?.getTime()).toBe(new Date(2026, 1, 3).getTime());
    expect(parseDateField("")).toBeNull();
    expect(parseDateField("2026-02")).toBeNull();
  });

  test("appendEntry starts the entry on its own line at the end", () => {
    expect(appendEntry("", "* TODO a\n")).toEqual({ from: 0, insert: "* TODO a\n" });
    expect(appendEntry("#+title: Inbox\n", "* TODO a\n")).toEqual({ from: 15, insert: "* TODO a\n" });
    expect(appendEntry("* TODO x", "* TODO a\n")).toEqual({ from: 8, insert: "\n* TODO a\n" });
  });

  test("sharedCaptureText puts the title or first line first and the URL as a link", () => {
    expect(sharedCaptureText({ title: "An article", url: "https://a.example/x" })).toBe("An article\n[[https://a.example/x]]");
    expect(sharedCaptureText({ text: "Look at this\nhttps://a.example/x" })).toBe("Look at this\n[[https://a.example/x]]");
    expect(sharedCaptureText({ text: "https://a.example/x" })).toBe("https://a.example/x");
    expect(sharedCaptureText({ title: "T", text: "some words\nhttps://a.example/x", url: "https://a.example/x" }))
      .toBe("T\nsome words\n[[https://a.example/x]]");
    expect(sharedCaptureText({})).toBe("");
  });
});

/** a button list in BUTTONS order, as every upgrade before version 9 leaves it (BAR-8) */
function inBarOrder(ids: string[]): string[] {
  return BUTTONS.map((b) => b.id as string).filter((id) => ids.includes(id));
}

describe("settings", () => {
  test("saved settings merge over copied defaults", () => {
    const s = mergeSettings({ journalFolder: "days" });
    expect(s.journalFolder).toBe("days");
    s.shortcutBarButtons.push("X");
    expect(DEFAULT_SETTINGS.shortcutBarButtons).not.toContain("X");
    expect(mergeSettings(null).shortcutBarVersion).toBe(9);
    expect(mergeSettings({ journalFolder: "days" }).shortcutBarVersion).toBe(1);
  });

  test("saved workflow choices are dropped: the flavour has them now", () => {
    const old = { headingDragHandles: true, todoKeywords: ["NEXT"], hideStars: true, backlinks: false, journalTemplate: "x", captureFile: "in.org" };
    const s = mergeSettings(old as never) as unknown as Record<string, unknown>;
    for (const key of ["headingDragHandles", "todoKeywords", "hideStars", "backlinks", "journalTemplate"]) expect(key in s, key).toBe(false);
    expect(s.captureFile).toBe("in.org");
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
      ["captureFile", "journalFolder", "shortcutBarButtons", "shortcutBarVersion", "shortcutCustomIcons", "showBacklinks", "showShortcutBar"]);
  });

  test("backlinks are on by default and can be turned off per vault", () => {
    expect(DEFAULT_SETTINGS.showBacklinks).toBe(true);
    expect(mergeSettings({ showBacklinks: false }).showBacklinks).toBe(false);
    expect(mergeSettings({ journalFolder: "days" }).showBacklinks).toBe(true);
  });

  test("migrateShortcutButtons enables undo/redo/visibility once and drops stars", () => {
    expect(migrateShortcutButtons(["stars", "todo"], 1).buttons).toEqual(inBarOrder(["undo", "redo", "visibility", "todo", "wiki-link", "heading-id", "new-heading", "src-block", "quote-block", "zoom", "node-find"]));
    expect(migrateShortcutButtons(["todo"], 9)).toEqual({ buttons: ["todo"], changed: false });
  });

  test("migrateShortcutButtons replaces id-link with wiki-link in place", () => {
    expect(migrateShortcutButtons(["undo", "id-link", "todo"], 3).buttons).toEqual(inBarOrder(["undo", "wiki-link", "todo", "heading-id", "new-heading", "src-block", "quote-block", "zoom", "node-find"]));
    expect(migrateShortcutButtons(["undo", "todo"], 3).buttons).toEqual(inBarOrder(["undo", "todo", "heading-id", "new-heading", "src-block", "quote-block", "zoom", "node-find"]));
  });

  test("migrateShortcutButtons adds heading-id once", () => {
    expect(migrateShortcutButtons(["undo", "todo"], 4)).toEqual({ buttons: inBarOrder(["undo", "todo", "heading-id", "new-heading", "src-block", "quote-block", "zoom", "node-find"]), changed: true });
    expect(migrateShortcutButtons(["heading-id", "undo"], 4).buttons).toEqual(inBarOrder(["heading-id", "undo", "new-heading", "src-block", "quote-block", "zoom", "node-find"]));
  });

  test("migrateShortcutButtons adds new-heading once", () => {
    expect(migrateShortcutButtons(["undo", "todo"], 5)).toEqual({ buttons: inBarOrder(["undo", "todo", "new-heading", "src-block", "quote-block", "zoom", "node-find"]), changed: true });
    expect(migrateShortcutButtons(["new-heading", "undo"], 5).buttons).toEqual(inBarOrder(["new-heading", "undo", "src-block", "quote-block", "zoom", "node-find"]));
    // turned off after the upgrade, it stays off
    expect(migrateShortcutButtons(["undo"], 9)).toEqual({ buttons: ["undo"], changed: false });
  });

  test("migrateShortcutButtons adds the source and quote block buttons once", () => {
    expect(migrateShortcutButtons(["undo"], 6)).toEqual({ buttons: inBarOrder(["undo", "src-block", "quote-block", "zoom", "node-find"]), changed: true });
    expect(migrateShortcutButtons(["quote-block", "undo"], 6).buttons).toEqual(inBarOrder(["quote-block", "undo", "src-block", "zoom", "node-find"]));
  });

  test("migrateShortcutButtons adds zoom and go to node once", () => {
    expect(migrateShortcutButtons(["undo"], 7)).toEqual({ buttons: inBarOrder(["undo", "zoom", "node-find"]), changed: true });
    expect(migrateShortcutButtons(["node-find"], 7).buttons).toEqual(inBarOrder(["node-find", "zoom"]));
  });

  test("migrateShortcutButtons puts a saved list in the old bar order once, then keeps the user's order", () => {
    expect(migrateShortcutButtons(["zoom", "undo", "stars", "todo"], 8)).toEqual({ buttons: ["undo", "zoom", "todo"], changed: true });
    expect(migrateShortcutButtons(["zoom", "undo", "todo"], 9)).toEqual({ buttons: ["zoom", "undo", "todo"], changed: false });
  });

  test("bar buttons follow the saved order and ignore unknown and repeated ids", () => {
    expect(BUTTONS.map((b) => b.id)).toEqual([
      "undo", "redo", "visibility", "zoom", "new-heading", "demote", "promote", "todo", "schedule", "deadline",
      "checkbox", "src-block", "quote-block", "wiki-link", "node-find", "heading-id", "journal", "journal-picker", "journal-calendar", "new-note", "capture", "attach", "record", "agenda",
    ]);
    expect(barButtons(["todo", "stars", "undo", "todo"]).map((b) => b.id)).toEqual(["todo", "undo"]);
  });

  test("a fresh bar has the editing buttons on and the journal and note buttons off", () => {
    expect(DEFAULT_SETTINGS.shortcutBarButtons).toEqual([
      "undo", "redo", "visibility", "zoom", "new-heading", "demote", "promote", "todo", "schedule", "deadline", "checkbox",
      "src-block", "quote-block", "wiki-link", "node-find", "heading-id",
    ]);
  });

  test("a button turned on goes to the end of the bar, and arrows move it past the shown buttons", () => {
    expect(toggleButton(["undo", "todo"], "zoom", true)).toEqual(["undo", "todo", "zoom"]);
    expect(toggleButton(["undo", "todo", "zoom"], "todo", false)).toEqual(["undo", "zoom"]);
    expect(toggleButton(["undo", "todo"], "undo", true)).toEqual(["todo", "undo"]);
    expect(moveButton(["undo", "todo", "zoom"], "zoom", -1)).toEqual(["undo", "zoom", "todo"]);
    expect(moveButton(["undo", "todo", "zoom"], "undo", -1)).toEqual(["undo", "todo", "zoom"]);
    expect(moveButton(["undo", "todo", "zoom"], "zoom", 1)).toEqual(["undo", "todo", "zoom"]);
    // a button no feature runs (here "journal") is skipped over and stays put
    const shown = (id: string) => id !== "journal";
    expect(moveButton(["undo", "journal", "todo"], "undo", 1, shown)).toEqual(["todo", "journal", "undo"]);
    expect(moveButton(["journal", "undo"], "undo", -1, shown)).toEqual(["journal", "undo"]);
  });

  test("a custom icon is used only when it names a known icon", () => {
    const todo = BUTTONS.find((b) => b.id === "todo")!;
    const known = (name: string) => name === "star";
    expect(buttonIconName(todo, " star ", known)).toBe("star");
    expect(buttonIconName(todo, "no-such-icon", known)).toBe("circle-check");
    expect(buttonIconName(todo, undefined, known)).toBe("circle-check");
  });
});

describe("conflicts", () => {
  test("the .org conflict notice names the plugin to turn off", () => {
    expect(orgConflictMessage(["calendar", "orgmode-cm6"], "orgmode")).toContain('because "Orgmode (cm6)" already does');
    expect(orgConflictMessage(["calendar"], "org-view")).toContain('because the plugin whose view is "org-view" already does');
    expect(orgConflictMessage([], null)).toContain("because another plugin already does");
  });
});
