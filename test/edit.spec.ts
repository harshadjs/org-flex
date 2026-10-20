import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState, TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { codeFolding, foldEffect } from "@codemirror/language";
import {
  assignId, continueList, insertBlock, insertHeading, cycleTaskState, decreaseHeadingLevel, increaseHeadingLevel, insertIdLink, insertWikiLink,
  orgDateString, setPlanningDate, toggleBoxOnLine, toggleCheckbox, toggleLeadingStars, currentPlanningDate,
} from "../src/org/edit";
import { parseItem } from "../src/org/lists";

const kw = { todo: ["TODO", "DOING", "WAITING"], done: ["DONE", "CANCELLED"] };

/** A state from text where "|" marks the cursor. */
function at(text: string): EditorState {
  const pos = text.indexOf("|");
  return EditorState.create({
    doc: text.replace("|", ""),
    selection: EditorSelection.cursor(pos < 0 ? 0 : pos),
    extensions: [history()],
  });
}

function apply(state: EditorState, spec: TransactionSpec | null): EditorState {
  expect(spec).not.toBeNull();
  return state.update(spec!).state;
}

function text(state: EditorState): string {
  return state.doc.toString();
}

describe("heading levels", () => {
  test("increaseHeadingLevel demotes headings and turns other lines into headings", () => {
    expect(text(apply(at("** H|"), increaseHeadingLevel(at("** H|"))))).toBe("*** H");
    expect(text(apply(at("plain|"), increaseHeadingLevel(at("plain|"))))).toBe("* plain");
  });

  test("decreaseHeadingLevel promotes, and a level-1 heading becomes text", () => {
    expect(text(apply(at("** H|"), decreaseHeadingLevel(at("** H|"))))).toBe("* H");
    expect(text(apply(at("* H|"), decreaseHeadingLevel(at("* H|"))))).toBe("H");
    expect(decreaseHeadingLevel(at("plain|"))).toBeNull();
  });

  test("heading actions do not treat *bold* text as a heading", () => {
    expect(text(apply(at("*bold*|"), increaseHeadingLevel(at("*bold*|"))))).toBe("* *bold*");
    expect(decreaseHeadingLevel(at("*bold*|"))).toBeNull();
  });

  test("toggleLeadingStars adds and removes stars", () => {
    expect(text(apply(at("x|"), toggleLeadingStars(at("x|"))))).toBe("* x");
    expect(text(apply(at("*** x|"), toggleLeadingStars(at("*** x|"))))).toBe("x");
  });
});

describe("task state", () => {
  const cycle = (s: string) => text(apply(at(s), cycleTaskState(at(s), kw)));

  test("cycleTaskState cycles none -> TODO -> DONE -> none", () => {
    expect(cycle("* Task|")).toBe("* TODO Task");
    expect(cycle("* TODO Task|")).toBe("* DONE Task");
    expect(cycle("* DONE Task|")).toBe("* Task");
  });

  test("any open keyword goes straight to the first done keyword", () => {
    expect(cycle("* WAITING [#A] Task|")).toBe("* DONE [#A] Task");
    expect(cycle("* CANCELLED Task|")).toBe("* Task");
  });

  test("cycleTaskState on plain text turns it into a TODO heading", () => {
    expect(cycle("  buy milk|")).toBe("* TODO buy milk");
  });
});

describe("planning dates", () => {
  const jan2 = new Date(2024, 0, 2);
  const feb5 = new Date(2024, 1, 5);

  test("orgDateString adds the English weekday", () => {
    expect(orgDateString(jan2)).toBe("2024-01-02 Tue");
  });

  test("setPlanningDate inserts, updates and removes SCHEDULED under a heading", () => {
    let s = at("* H|\nbody");
    s = apply(s, setPlanningDate(s, "SCHEDULED", jan2));
    expect(text(s)).toBe("* H\nSCHEDULED: <2024-01-02 Tue>\nbody");
    expect(currentPlanningDate(s, "SCHEDULED")).toEqual(jan2);
    s = apply(s, setPlanningDate(s, "SCHEDULED", feb5));
    expect(text(s)).toBe("* H\nSCHEDULED: <2024-02-05 Mon>\nbody");
    s = apply(s, setPlanningDate(s, "SCHEDULED", null));
    expect(text(s)).toBe("* H\nbody");
  });

  test("setPlanningDate shares the planning line with other entries", () => {
    let s = at("* H|\nDEADLINE: <2024-01-02 Tue>");
    s = apply(s, setPlanningDate(s, "SCHEDULED", feb5));
    expect(text(s)).toBe("* H\nDEADLINE: <2024-01-02 Tue> SCHEDULED: <2024-02-05 Mon>");
    s = apply(s, setPlanningDate(s, "DEADLINE", null));
    expect(text(s)).toBe("* H\nSCHEDULED: <2024-02-05 Mon>");
  });

  test("setPlanningDate works from a body line and keeps time and repeater", () => {
    let s = at("* H\n  SCHEDULED: <2024-01-02 Tue 10:00 +1w>\nsome |text");
    s = apply(s, setPlanningDate(s, "SCHEDULED", feb5));
    expect(text(s)).toBe("* H\n  SCHEDULED: <2024-02-05 Mon 10:00 +1w>\nsome text");
  });

  test("setPlanningDate needs a heading and ignores *bold* text", () => {
    expect(setPlanningDate(at("*bold*\ntext|"), "SCHEDULED", jan2)).toBeNull();
  });
});

describe("new heading", () => {
  const cursor = (s: EditorState) => s.selection.main.head;

  test("insertHeading puts a heading at the current level right below the line", () => {
    let s = at("* A\n** B\nsome |text\nmore");
    s = apply(s, insertHeading(s));
    expect(text(s)).toBe("* A\n** B\nsome text\n** \nmore");
    expect(cursor(s)).toBe("* A\n** B\nsome text\n** ".length);
    // on a heading line: a sibling of that heading
    s = at("* A\n** B|\nbody");
    s = apply(s, insertHeading(s));
    expect(text(s)).toBe("* A\n** B\n** \nbody");
  });

  test("insertHeading turns a blank line into the heading, and uses level 1 before any heading", () => {
    let s = at("* A\ntext\n  |\nmore");
    s = apply(s, insertHeading(s));
    expect(text(s)).toBe("* A\ntext\n* \nmore");
    expect(cursor(s)).toBe("* A\ntext\n* ".length);
    s = at("intro|");
    expect(text(apply(s, insertHeading(s)))).toBe("intro\n* ");
    s = at("|");
    expect(text(apply(s, insertHeading(s)))).toBe("* ");
    // *bold* text is not a heading
    s = at("*bold* |text");
    expect(text(apply(s, insertHeading(s)))).toBe("*bold* text\n* ");
  });

  test("insertHeading on a folded heading goes below the hidden text", () => {
    let s = EditorState.create({
      doc: "* A\nhidden\n* B",
      selection: EditorSelection.cursor(1),
      extensions: [codeFolding()],
    });
    s = s.update({ effects: foldEffect.of({ from: 3, to: 10 }) }).state;
    s = apply(s, insertHeading(s));
    expect(text(s)).toBe("* A\nhidden\n* \n* B");
    expect(cursor(s)).toBe("* A\nhidden\n* ".length);
  });
});

describe("IDs", () => {
  const ID = "0b6e1c3a-1f2d-4c5e-9a8b-7c6d5e4f3a2b";

  test("assignId adds a property drawer with the ID under the heading, after its planning line", () => {
    let s = at("* H|\ntext\n* Next");
    s = apply(s, assignId(s, ID));
    expect(text(s)).toBe(`* H\n:PROPERTIES:\n:ID:       ${ID}\n:END:\ntext\n* Next`);
    // the cursor stays where it was
    expect(s.selection.main.head).toBe(3);
    s = at("* H\n  SCHEDULED: <2024-01-02 Tue>\nsome |text");
    s = apply(s, assignId(s, ID));
    expect(text(s)).toBe(`* H\n  SCHEDULED: <2024-01-02 Tue>\n:PROPERTIES:\n:ID:       ${ID}\n:END:\nsome text`);
    // a heading at the end of a file without a final newline
    s = at("* a\n** b|");
    expect(text(apply(s, assignId(s, ID)))).toBe(`* a\n** b\n:PROPERTIES:\n:ID:       ${ID}\n:END:`);
  });

  test("assignId adds to an existing drawer, fills an empty ID, and keeps an existing one", () => {
    let s = at("* H\n  :PROPERTIES:\n  :CUSTOM: x\n  :END:\nbody|");
    s = apply(s, assignId(s, ID));
    expect(text(s)).toBe(`* H\n  :PROPERTIES:\n  :ID:       ${ID}\n  :CUSTOM: x\n  :END:\nbody`);
    s = at("* H|\n:PROPERTIES:\n:ID:\n:END:");
    expect(text(apply(s, assignId(s, ID)))).toBe(`* H\n:PROPERTIES:\n:ID:       ${ID}\n:END:`);
    expect(assignId(at("* H|\n:PROPERTIES:\n:ID: old\n:END:"), ID)).toBeNull();
    // an unclosed drawer isn't one: a new drawer goes in
    s = at("* H|\n:PROPERTIES:\n* Next");
    expect(text(apply(s, assignId(s, ID)))).toBe(`* H\n:PROPERTIES:\n:ID:       ${ID}\n:END:\n:PROPERTIES:\n* Next`);
  });

  test("assignId before the first heading gives the file an ID, and ignores *bold* text", () => {
    let s = at("#+title: Note\n|intro\n* H");
    s = apply(s, assignId(s, ID));
    expect(text(s)).toBe(`:PROPERTIES:\n:ID:       ${ID}\n:END:\n#+title: Note\nintro\n* H`);
    s = at(":PROPERTIES:\n:CREATED: x\n:END:\n*bold* |text");
    s = apply(s, assignId(s, ID));
    expect(text(s)).toBe(`:PROPERTIES:\n:ID:       ${ID}\n:CREATED: x\n:END:\n*bold* text`);
    expect(assignId(at(`:PROPERTIES:\n:ID: ${ID}\n:END:\nbody|`), ID)).toBeNull();
  });

  test("assignId is one undoable change", () => {
    let s = at("* H|\ntext");
    s = apply(s, assignId(s, ID));
    undo({ state: s, dispatch: (tr) => (s = tr.state) });
    expect(text(s)).toBe("* H\ntext");
  });
});

describe("checklists", () => {
  test("parseItem recognises bullets and boxes", () => {
    expect(parseItem("- [ ] a")).toMatchObject({ bullet: "-", box: { state: " " } });
    expect(parseItem("  + [X] a")).toMatchObject({ indent: 2, box: { state: "x" } });
    expect(parseItem("1. [-] a")).toMatchObject({ bullet: "1.", box: { state: "-" } });
    expect(parseItem("2) a")).toMatchObject({ bullet: "2)", box: null });
    expect(parseItem("  * a")).toMatchObject({ bullet: "*" });
    expect(parseItem("* a")).toBeNull();
    expect(parseItem("-a")).toBeNull();
    expect(parseItem("- [x]done")).toMatchObject({ box: null });
    expect(parseItem("-")).toMatchObject({ bullet: "-" });
  });

  test("checkbox-like lines inside blocks are not list items", () => {
    const s = at("#+begin_example\n- [ ] |a\n#+end_example");
    expect(toggleBoxOnLine(s, 1)).toBeNull();
    expect(toggleCheckbox(s)).toBeNull();
    expect(continueList(s)).toBeNull();
  });

  test("toggling an item updates the heading cookie", () => {
    const s = at("* Tasks [0/2]\n- [ ] a\n- [ ] b");
    expect(text(apply(s, toggleBoxOnLine(s, 1)))).toBe("* Tasks [1/2]\n- [x] a\n- [ ] b");
  });

  test("percent cookies and parent boxes follow their children", () => {
    const s = at("* T [%]\n- [ ] parent [/]\n  - [ ] a\n  - [ ] b\n  - [ ] c\n- [ ] other");
    const s2 = apply(s, toggleBoxOnLine(s, 2));
    expect(text(s2)).toBe("* T [0%]\n- [-] parent [1/3]\n  - [x] a\n  - [ ] b\n  - [ ] c\n- [ ] other");
  });

  test("checking a parent checks all its children", () => {
    const s = at("- [ ] p [0/2]\n  - [ ] a\n    - [ ] deep\n  - [ ] b");
    expect(text(apply(s, toggleBoxOnLine(s, 0)))).toBe("- [x] p [2/2]\n  - [x] a\n    - [x] deep\n  - [x] b");
  });

  test("each heading's cookie counts only its own section", () => {
    const s = at("* A [/]\n- [ ] a\n** B [/]\n- [x] b1\n- [ ] b2");
    expect(text(apply(s, toggleBoxOnLine(s, 1)))).toBe("* A [1/1]\n- [x] a\n** B [/]\n- [x] b1\n- [ ] b2");
  });

  test("text at or left of an item's indentation ends it", () => {
    const s = at("- [ ] p [/]\nnot in the list\n  - [ ] a");
    expect(text(apply(s, toggleBoxOnLine(s, 2)))).toBe("- [ ] p [0/0]\nnot in the list\n  - [x] a");
  });

  test("toggling is a single undoable change", () => {
    const s = at("* T [0/1]\n- [ ] a");
    const s2 = apply(s, toggleBoxOnLine(s, 1));
    let undone = s2;
    undo({ state: s2, dispatch: (tr) => (undone = tr.state) });
    expect(text(undone)).toBe("* T [0/1]\n- [ ] a");
  });

  test("toggleCheckbox cycles plain text -> [ ] -> [x] -> none and recounts", () => {
    let s = at("* T [/]\n|buy milk");
    s = apply(s, toggleCheckbox(s));
    expect(text(s)).toBe("* T [0/1]\n- [ ] buy milk");
    s = apply(s, toggleCheckbox(s));
    expect(text(s)).toBe("* T [1/1]\n- [x] buy milk");
    s = apply(s, toggleCheckbox(s));
    expect(text(s)).toBe("* T [0/0]\n- buy milk");
  });

  test("toggleCheckbox handles [X], [-], ordered lists and headings", () => {
    const x = at("- [X] a|");
    expect(text(apply(x, toggleCheckbox(x)))).toBe("- a");
    const partial = at("- [-] a|");
    expect(text(apply(partial, toggleCheckbox(partial)))).toBe("- [x] a");
    const ordered = at("1. a|");
    expect(text(apply(ordered, toggleCheckbox(ordered)))).toBe("1. [ ] a");
    expect(toggleCheckbox(at("* heading|"))).toBeNull();
  });

  test("Enter continues a checklist with an unchecked item", () => {
    const s = at("* T [1/1]\n- [x] a|");
    const s2 = apply(s, continueList(s));
    expect(text(s2)).toBe("* T [1/2]\n- [x] a\n- [ ] ");
    expect(s2.selection.main.head).toBe(s2.doc.length);
  });

  test("Enter splits an item at the cursor and numbers ordered lists", () => {
    const s = at("  1. first |second");
    const s2 = apply(s, continueList(s));
    expect(text(s2)).toBe("  1. first\n  2. second");
    expect(s2.selection.main.head).toBe("  1. first\n  2. ".length);
  });

  test("Enter on an empty item ends the list", () => {
    const s = at("- a\n- |");
    expect(text(apply(s, continueList(s)))).toBe("- a\n");
  });

  test("Enter outside list items, or before the item text, is left to the default", () => {
    expect(continueList(at("plain|"))).toBeNull();
    expect(continueList(at("-| [ ] a"))).toBeNull();
    expect(continueList(at("* heading|"))).toBeNull();
  });
});

describe("links", () => {
  test("insertIdLink inserts [[id:]] with the cursor after the colon", () => {
    const s = apply(at("see |"), insertIdLink(at("see |")));
    expect(text(s)).toBe("see [[id:]]");
    expect(s.selection.main.head).toBe(9);
  });

  test("insertWikiLink inserts [[]] with the cursor between the brackets", () => {
    const s = apply(at("see |"), insertWikiLink(at("see |")));
    expect(text(s)).toBe("see [[]]");
    expect(s.selection.main.head).toBe(6);
  });

  test("insertWikiLink wraps a selection and puts the cursor after it", () => {
    const s0 = EditorState.create({ doc: "see pkm now", selection: EditorSelection.range(4, 7) });
    const s = apply(s0, insertWikiLink(s0));
    expect(text(s)).toBe("see [[pkm]] now");
    expect(s.selection.main.head).toBe(11);
  });
});

describe("blocks", () => {
  const cursor = (s: EditorState) => s.selection.main.head;

  test("insertBlock puts a source block below the line with the cursor where the language goes", () => {
    let s = at("* A\nsome |text\nmore");
    s = apply(s, insertBlock(s, "src"));
    expect(text(s)).toBe("* A\nsome text\n#+begin_src \n\n#+end_src\nmore");
    expect(cursor(s)).toBe("* A\nsome text\n#+begin_src ".length);
    s = at("a\n  |\nb");
    s = apply(s, insertBlock(s, "src"));
    expect(text(s)).toBe("a\n#+begin_src \n\n#+end_src\nb");
  });

  test("insertBlock puts a quote block below the line, or on a blank line, with the cursor inside", () => {
    let s = at("text|");
    s = apply(s, insertBlock(s, "quote"));
    expect(text(s)).toBe("text\n#+begin_quote\n\n#+end_quote");
    expect(cursor(s)).toBe("text\n#+begin_quote\n".length);
    s = at("|");
    s = apply(s, insertBlock(s, "quote"));
    expect(text(s)).toBe("#+begin_quote\n\n#+end_quote");
    expect(cursor(s)).toBe("#+begin_quote\n".length);
  });

  test("insertBlock wraps the selected lines", () => {
    let s = EditorState.create({ doc: "x\none two\nthree\ny", selection: EditorSelection.range(4, 13) });
    s = apply(s, insertBlock(s, "quote"));
    expect(text(s)).toBe("x\n#+begin_quote\none two\nthree\n#+end_quote\ny");
    expect(cursor(s)).toBe("x\n#+begin_quote\none two\nthree".length);
    // a selection ending at a line start leaves that line out
    s = EditorState.create({ doc: "one\ntwo", selection: EditorSelection.range(0, 4) });
    s = apply(s, insertBlock(s, "src"));
    expect(text(s)).toBe("#+begin_src \none\n#+end_src\ntwo");
    expect(cursor(s)).toBe("#+begin_src ".length);
  });

  test("insertBlock on a folded heading goes below the hidden text", () => {
    let s = EditorState.create({
      doc: "* A\nhidden\n* B",
      selection: EditorSelection.cursor(1),
      extensions: [codeFolding()],
    });
    s = s.update({ effects: foldEffect.of({ from: 3, to: 10 }) }).state;
    s = apply(s, insertBlock(s, "quote"));
    expect(text(s)).toBe("* A\nhidden\n#+begin_quote\n\n#+end_quote\n* B");
  });
});
