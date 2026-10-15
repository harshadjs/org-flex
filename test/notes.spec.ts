import { describe, expect, test } from "vitest";
import { Text } from "@codemirror/state";
import { analyze } from "../src/org/syntax";
import { foldAt, nextVisibility, visibilityFolds } from "../src/org/folding";
import { displayValue, parseFrontMatter, propertyIcon, simplifyValue } from "../src/org/front-matter";
import {
  calendarMonth, journalDateString, journalEntries, journalEntryLabel, journalFileContent, journalPathForDate,
} from "../src/org/journal";
import { notePath, noteFileContent, titleProblem } from "../src/org/new-note";
import {
  barButtons, BUTTONS, buttonIconName, mergeSettings, migrateShortcutButtons, parseKeywordList, DEFAULT_SETTINGS,
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

  test("journalFileContent uses the date as ID and title", () => {
    expect(journalFileContent(d)).toBe(":PROPERTIES:\n:ID:       2024-03-05\n:END:\n#+title: 2024-03-05\n#+filetags: :journal:\n\n");
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

  test("noteFileContent uses the UUID as ID and the title as #+title", () => {
    expect(noteFileContent(" My Note ", "0b6e1c3a-1f2d-4c5e-9a8b-7c6d5e4f3a2b"))
      .toBe(":PROPERTIES:\n:ID:       0b6e1c3a-1f2d-4c5e-9a8b-7c6d5e4f3a2b\n:END:\n#+title: My Note\n\n");
  });
});

describe("settings", () => {
  test("saved settings merge over copied defaults", () => {
    const s = mergeSettings({ hideStars: true });
    expect(s.hideStars).toBe(true);
    s.todoKeywords.push("X");
    expect(DEFAULT_SETTINGS.todoKeywords).not.toContain("X");
    expect(mergeSettings(null).shortcutBarVersion).toBe(4);
    expect(mergeSettings({ hideStars: true }).shortcutBarVersion).toBe(1);
  });

  test("migrateShortcutButtons enables undo/redo/visibility once and drops stars", () => {
    expect(migrateShortcutButtons(["stars", "todo"], 1).buttons).toEqual(["undo", "redo", "visibility", "todo", "wiki-link"]);
    expect(migrateShortcutButtons(["todo"], 4)).toEqual({ buttons: ["todo"], changed: false });
  });

  test("migrateShortcutButtons replaces id-link with wiki-link in place", () => {
    expect(migrateShortcutButtons(["undo", "id-link", "todo"], 3).buttons).toEqual(["undo", "wiki-link", "todo"]);
    expect(migrateShortcutButtons(["undo", "todo"], 3).buttons).toEqual(["undo", "todo"]);
  });

  test("bar buttons keep BUTTONS order and ignore unknown ids", () => {
    expect(BUTTONS.map((b) => b.id)).toEqual([
      "undo", "redo", "visibility", "demote", "promote", "todo", "schedule", "deadline",
      "checkbox", "wiki-link", "journal", "journal-picker", "journal-calendar", "new-note",
    ]);
    expect(barButtons(["todo", "stars", "undo"]).map((b) => b.id)).toEqual(["undo", "todo"]);
  });

  test("a fresh bar has the editing buttons on and the journal and note buttons off", () => {
    expect(DEFAULT_SETTINGS.shortcutBarButtons).toEqual([
      "undo", "redo", "visibility", "demote", "promote", "todo", "schedule", "deadline", "checkbox", "wiki-link",
    ]);
  });

  test("a custom icon is used only when it names a known icon", () => {
    const todo = BUTTONS.find((b) => b.id === "todo")!;
    const known = (name: string) => name === "star";
    expect(buttonIconName(todo, " star ", known)).toBe("star");
    expect(buttonIconName(todo, "no-such-icon", known)).toBe("circle-check");
    expect(buttonIconName(todo, undefined, known)).toBe("circle-check");
  });

  test("keyword lists accept commas or newlines", () => {
    expect(parseKeywordList("TODO, NEXT\nWAIT,,\n")).toEqual(["TODO", "NEXT", "WAIT"]);
  });
});
