// @vitest-environment happy-dom
// Mounts the editor with every extension in a fake DOM, to catch errors that
// only show up when decorations are drawn (ordering, block widgets, ...).
import { expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { docInfo, orgConfig, orgHost, DEFAULT_CONFIG } from "../src/editor/state";
import { livePreview } from "../src/editor/preview";
import { srcHighlight } from "../src/editor/src-highlight";
import { applyVisibility, orgFolding } from "../src/editor/folding";
import { checklists } from "../src/editor/checklists";
import { frontMatterPanel } from "../src/editor/front-matter-panel";
import { backlinksSection, setBacklinks } from "../src/editor/backlinks";
import { headingDrag } from "../src/editor/heading-drag";
import { shortcutBar } from "../src/editor/shortcut-bar";
import { CompletionContext } from "@codemirror/autocomplete";
import { linkCompletions, orgCompletion } from "../src/editor/completion";
import { BUTTONS } from "../src/settings";

const doc = `:PROPERTIES:
:ID:       note
:END:
#+title: A *note*
#+filetags: :a:b:

Intro with *bold /italic/* and [[pkm][PKM]] and [[img.png]] and https://x.y.
* TODO [#A] Heading :tag:
SCHEDULED: <2024-01-02 Tue>
:PROPERTIES:
:ID: h
:END:
- [ ] one [0/1]
  - [ ] two
- [x] done
#+begin_src python
def f(): return "x"  # c
#+end_src
#+begin_quote
quoted =v=
#+end_quote
** Sub
# comment
*** Deep`;

test("the editor renders every feature without errors", () => {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const actions = { open() {}, link() {}, toggle() {} };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        orgConfig.of({ ...DEFAULT_CONFIG, frontMatterPanel: true, hideStars: true, keywords: { todo: ["TODO"], done: ["DONE"] } }),
        orgHost.of({ setIcon() {}, openLink() {}, imageSrc: () => null, linkCompletions: () => [], idCompletions: () => [] }),
        docInfo, history(), livePreview(), srcHighlight, orgFolding(), checklists(), orgCompletion(),
        frontMatterPanel(), backlinksSection(actions), headingDrag(),
        shortcutBar({ buttons: BUTTONS, icon: (d) => d.icon, setIcon() {}, run() {} }),
      ],
    }),
  });
  for (const level of ["foldall", "outline", "expandall"] as const) applyVisibility(view, level);
  view.dispatch({ effects: setBacklinks.of({
    backlinks: [{ path: "a.org", title: "A", lines: [{ line: 1, text: "see [[note]]" }] }],
    mentions: [{ path: "b.org", title: "B", line: 0, text: "a note", from: 2, to: 6, words: "note" }],
    linkedOpen: true, mentionsOpen: true,
  }) });
  // move the cursor through every line, so raw and rendered forms both draw
  for (let n = 1; n <= view.state.doc.lines; n++) {
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(n).from + 1), userEvent: "select" });
  }
  view.dispatch({ changes: { from: view.state.doc.length, insert: "\n- [ ] new" } });
  const html = view.dom.innerHTML;
  expect(html).toContain("org-shortcut-bar");
  expect(html).toContain("org-backlinks");
  expect(html).toContain("org-tok-");
  expect(html).toContain("task-list-item-checkbox");
  // the cursor is at the end, so the front matter shows as the panel
  expect(view.dom.querySelector(".org-front-matter-title")?.textContent).toBe("A *note*");
  expect(view.dom.querySelector(".org-properties-count")?.textContent).toBe("2");
  view.destroy();
});

test("picking a title after [[ inserts an ID link with the title as description", () => {
  const host = {
    setIcon() {}, openLink() {}, imageSrc: () => null, idCompletions: () => [],
    linkCompletions: () => [
      { label: "Org roam", detail: "notes", target: "id:5f0c-uuid", description: "Org roam", type: "note" },
      { label: "img.png", target: "img.png", type: "file" },
    ],
  };
  const pick = (doc: string, label: string) => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, selection: { anchor: doc.indexOf("|") }, extensions: [orgHost.of(host)] }),
    });
    view.dispatch({ changes: { from: doc.indexOf("|"), to: doc.indexOf("|") + 1 } });
    const pos = view.state.selection.main.head;
    const result = linkCompletions(new CompletionContext(view.state, pos, true))!;
    const option = result.options.find((o) => o.label === label)!;
    expect(option.label).not.toContain("uuid");
    (option.apply as (v: EditorView, c: typeof option, from: number, to: number) => void)(view, option, result.from, pos);
    const out = { text: view.state.doc.toString(), cursor: view.state.selection.main.head };
    view.destroy();
    return out;
  };
  expect(pick("See [[org|", "Org roam")).toEqual({ text: "See [[id:5f0c-uuid][Org roam]]", cursor: 30 });
  // a closing ]] already there (the link button) is reused, and the cursor ends after it
  expect(pick("See [[|]] next", "Org roam")).toEqual({ text: "See [[id:5f0c-uuid][Org roam]] next", cursor: 30 });
  expect(pick("[[im|", "img.png")).toEqual({ text: "[[img.png]]", cursor: 11 });
});
