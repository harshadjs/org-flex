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
import { shortcutBar } from "../src/editor/shortcut-bar";
import { CompletionContext, completionStatus, currentCompletions } from "@codemirror/autocomplete";
import { exactIdMatches, insertLinkWithCompletion, linkButton, linkCompletions, orgCompletion } from "../src/editor/completion";
import { insertIdLink, insertWikiLink } from "../src/org/edit";
import { BUTTONS } from "../src/settings";
import { orgZoom, toggleZoom } from "../src/editor/zoom";

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
        docInfo, history(), livePreview(), srcHighlight, orgFolding(), checklists(), orgCompletion(), orgZoom(),
        frontMatterPanel(), backlinksSection(actions),
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
  // zoomed into "** Sub", the front matter, the task and its lists are hidden
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf("# comment")) });
  applyVisibility(view, "foldall");
  expect(toggleZoom(view)).toBe(true);
  expect(view.dom.querySelector(".org-front-matter-title")).toBeNull();
  expect(Array.from(view.contentDOM.querySelectorAll(".cm-line")).map((l) => l.textContent?.trim())).toEqual(["Sub", "# comment", "Deep", "-  new"]);
  expect(Array.from(view.dom.querySelectorAll(".org-zoom-crumb")).map((c) => c.textContent)).toEqual(["Whole file", "Heading", "Sub"]);
  toggleZoom(view);
  expect(view.dom.querySelector(".org-front-matter-title")?.textContent).toBe("A *note*");
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

test("after [[denote: the list offers Denote identifiers, after [[id: org IDs", () => {
  const host = {
    setIcon() {}, openLink() {}, imageSrc: () => null, linkCompletions: () => [],
    idCompletions: (scheme?: "id" | "denote") => scheme === "denote" ? [{ label: "2610a", target: "2610a" }] : [{ label: "5f0c-uuid", target: "5f0c-uuid" }],
  };
  const labels = (doc: string) => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [orgHost.of(host)] }) });
    const result = linkCompletions(new CompletionContext(view.state, doc.length, true))!;
    view.destroy();
    return { from: result.from, labels: result.options.map((o) => o.label) };
  };
  expect(labels("[[denote:26")).toEqual({ from: 9, labels: ["2610a"] });
  expect(labels("[[id:5f")).toEqual({ from: 5, labels: ["5f0c-uuid"] });
});

test("a title nobody has yet can be picked to create the note, linked by its new ID", () => {
  const created: string[] = [];
  const host = {
    setIcon() {}, openLink() {}, imageSrc: () => null,
    idCompletions: () => [{ label: "5f0c-uuid", target: "5f0c-uuid" }],
    linkCompletions: () => [{ label: "Org roam", target: "id:5f0c-uuid", description: "Org roam", type: "note" }],
    createNote: (title: string) => { created.push(title); return "id:new-uuid"; },
  };
  const query = (doc: string) => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [orgHost.of(host)] }) });
    const pos = doc.length;
    const result = linkCompletions(new CompletionContext(view.state, pos, true));
    return { view, pos, result };
  };
  const creates = (doc: string) => query(doc).result?.options.filter((o) => o.detail === "Create note").map((o) => o.label) ?? [];
  expect(creates("[[Fresh idea ")).toEqual(["Fresh idea "]);
  // an exact title (ignoring case and spaces around it) is offered as it is, not created again
  expect(creates("[[org ROAM ")).toEqual([]);
  expect(creates("[[")).toEqual([]);
  expect(creates("[[id:abc")).toEqual([]);
  const { view, pos, result } = query("See [[ Fresh idea");
  // the entry follows what's typed, so the list is never reused
  expect(result!.validFor).toBeUndefined();
  const option = result!.options.find((o) => o.detail === "Create note")!;
  (option.apply as (v: EditorView, c: typeof option, from: number, to: number) => void)(view, option, result!.from, pos);
  expect(created).toEqual(["Fresh idea"]);
  expect(view.state.doc.toString()).toBe("See [[id:new-uuid][Fresh idea]]");
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  view.destroy();
});

test("the create entry comes after every match and follows the typing", async () => {
  const host = {
    setIcon() {}, openLink() {}, imageSrc: () => null, idCompletions: () => [],
    linkCompletions: () => [{ label: "Org roam", target: "id:5f0c-uuid", description: "Org roam", type: "note" }],
    createNote: () => "id:new-uuid",
  };
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "[[", selection: { anchor: 2 }, extensions: [orgHost.of(host), orgCompletion()] }),
  });
  const type = async (text: string) => {
    for (const ch of text) {
      const p = view.state.selection.main.head;
      view.dispatch({ changes: { from: p, insert: ch }, selection: { anchor: p + 1 }, userEvent: "input.type" });
      await new Promise((r) => setTimeout(r, 100));
    }
    return currentCompletions(view.state).map((c) => c.label);
  };
  expect(await type("Or")).toEqual(["Org roam", "Or"]);
  expect(await type(" new")).toEqual(["Or new"]);
  view.destroy();
});

test("the link button and ID link command open the list straight away, without typing", async () => {
  const host = {
    setIcon() {}, openLink() {}, imageSrc: () => null,
    idCompletions: () => [{ label: "5f0c-uuid", target: "5f0c-uuid" }],
    linkCompletions: () => [{ label: "Org roam", target: "id:5f0c-uuid", description: "Org roam", type: "note" }],
  };
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "See ", selection: { anchor: 4 }, extensions: [orgHost.of(host), orgCompletion()] }),
  });
  const settle = () => new Promise((r) => setTimeout(r, 100));
  insertLinkWithCompletion(view, insertWikiLink(view.state));
  expect(view.state.doc.toString()).toBe("See [[]]");
  await settle();
  expect(completionStatus(view.state)).toBe("active");
  expect(currentCompletions(view.state).map((c) => c.label)).toEqual(["Org roam"]);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "See " }, selection: { anchor: 4 } });
  await settle();
  insertLinkWithCompletion(view, insertIdLink(view.state));
  await settle();
  expect(currentCompletions(view.state).map((c) => c.label)).toEqual(["5f0c-uuid"]);
  view.destroy();
});

test("the link button links selected words to the one note or heading with that title", async () => {
  const host = {
    setIcon() {}, openLink() {}, imageSrc: () => null, idCompletions: () => [],
    linkCompletions: () => [
      { label: "Trip Plans", target: "id:trip", description: "Trip Plans", type: "note" },
      { label: "Notes", target: "id:n1", description: "Notes", type: "note" },
      { label: "notes", target: "id:n2", description: "notes", type: "note" },
      { label: "Packing", target: "Packing", type: "file" },
    ],
    createNote: () => "id:new-uuid",
  };
  expect(exactIdMatches(host.linkCompletions(), " trip plans ").map((m) => m.target)).toEqual(["id:trip"]);
  expect(exactIdMatches(host.linkCompletions(), "Packing")).toEqual([]);
  const settle = () => new Promise((r) => setTimeout(r, 100));
  const press = (doc: string, from: number, to: number) => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: [orgHost.of(host), orgCompletion()] }),
    });
    linkButton(view);
    return view;
  };

  // one exact match: linked straight away with the words as written; spaces stay outside
  let view = press("See the trip plans now", 7, 19);
  expect(view.state.doc.toString()).toBe("See the [[id:trip][trip plans]] now");
  expect(view.state.selection.main.head).toBe(31);
  await settle();
  expect(completionStatus(view.state)).toBeNull();
  view.destroy();

  // two with that title: the list opens on the words; picking one keeps the words
  view = press("Read notes", 5, 10);
  expect(view.state.doc.toString()).toBe("Read [[notes]]");
  await settle();
  expect(completionStatus(view.state)).toBe("active");
  const labels = currentCompletions(view.state).map((c) => c.label);
  expect(labels).toContain("Notes");
  expect(labels).toContain("notes");
  const result = linkCompletions(new CompletionContext(view.state, view.state.selection.main.head, true))!;
  const option = result.options.find((o) => o.label === "Notes")!;
  (option.apply as (v: EditorView, c: typeof option, from: number, to: number) => void)(view, option, result.from, view.state.selection.main.head);
  expect(view.state.doc.toString()).toBe("Read [[id:n1][notes]]");
  view.destroy();

  // no ID match (a file has that name): the list opens on the words, files and create included
  view = press("Do Packing", 3, 10);
  expect(view.state.doc.toString()).toBe("Do [[Packing]]");
  await settle();
  expect(currentCompletions(view.state).map((c) => c.label)).toContain("Packing");
  view.destroy();

  // over two lines: wrapped as before, no list
  view = press("a\nb", 0, 3);
  expect(view.state.doc.toString()).toBe("[[a\nb]]");
  await settle();
  expect(completionStatus(view.state)).toBeNull();
  view.destroy();
});

test("after the link button's words are edited, picking an entry uses its title", () => {
  const host = {
    setIcon() {}, openLink() {}, imageSrc: () => null, idCompletions: () => [],
    linkCompletions: () => [{ label: "Notes", target: "id:n1", description: "Notes", type: "note" }, { label: "notes", target: "id:n2", description: "notes", type: "note" }],
  };
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "Read notes", selection: EditorSelection.single(5, 10), extensions: [orgHost.of(host), orgCompletion()] }),
  });
  linkButton(view);
  view.dispatch({ changes: { from: 12, insert: "s" }, selection: { anchor: 13 } });
  const result = linkCompletions(new CompletionContext(view.state, 13, true))!;
  const option = result.options.find((o) => o.label === "Notes")!;
  (option.apply as (v: EditorView, c: typeof option, from: number, to: number) => void)(view, option, result.from, 13);
  expect(view.state.doc.toString()).toBe("Read [[id:n1][Notes]]");
  view.destroy();
});
