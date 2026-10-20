// @vitest-environment happy-dom
// Rules about what the editor draws and how taps behave, checked in a fake DOM.
import { afterEach, expect, test } from "vitest";
import { Compartment, EditorSelection, EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import { DEFAULT_CONFIG, onTap, OrgHost, orgConfig, orgHost } from "../src/editor/state";
import { coreExtensions, externalChange, lockOuterScroll, trackKeyboard } from "../src/editor/setup";
import { applyVisibility } from "../src/editor/folding";
import { frontMatterPanel } from "../src/editor/front-matter-panel";
import { BacklinksActions, backlinksSection, setBacklinks } from "../src/editor/backlinks";
import { shortcutBar } from "../src/editor/shortcut-bar";
import { revealZoomEffects, toggleZoom, zoomField, zoomToHeadingAt } from "../src/editor/zoom";
import { BUTTONS, ButtonId } from "../src/settings";

const views: EditorView[] = [];
afterEach(() => {
  while (views.length) views.pop()!.destroy();
  document.body.innerHTML = "";
});

interface Opened { links: string[]; icons: Map<HTMLElement, string> }

function mount(doc: string, extensions: Extension = [], cursor = doc.length, config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const opened: Opened = { links: [], icons: new Map() };
  const host: OrgHost = {
    setIcon: (el, icon) => void opened.icons.set(el, icon),
    openLink: (target) => void opened.links.push(target),
    imageSrc: () => null,
    linkCompletions: () => [],
    idCompletions: () => [],
  };
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        orgConfig.of({ ...DEFAULT_CONFIG, keywords: { todo: ["TODO"], done: ["DONE"] }, ...config }),
        orgHost.of(host),
        coreExtensions({ spellcheck: true }),
        extensions,
      ],
    }),
  });
  views.push(view);
  return { view, opened };
}

function lineEl(view: EditorView, n: number): HTMLElement {
  const { node, offset } = view.domAtPos(view.state.doc.line(n).from);
  let el: Node | null = node.nodeType === 1 && (node as HTMLElement).classList.contains("cm-content") ? node.childNodes[offset] : node;
  while (el && !(el.nodeType === 1 && (el as HTMLElement).classList.contains("cm-line"))) el = el.parentNode;
  return el as HTMLElement;
}

function touch(el: Element, type: "touchstart" | "touchend", x: number, y: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y, target: el }];
  Object.defineProperty(e, "changedTouches", { value: list });
  Object.defineProperty(e, "targetTouches", { value: type === "touchstart" ? list : [] });
  Object.defineProperty(e, "touches", { value: type === "touchstart" ? list : [] });
  el.dispatchEvent(e);
  return e;
}

function tap(el: Element, moved = 0) {
  touch(el, "touchstart", 10, 10);
  return touch(el, "touchend", 10 + moved, 10);
}

function mouse(el: Element, type: string): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
  el.dispatchEvent(e);
  return e;
}

// ---------------------------------------------------------------- the view

test("the keymap: Tab indents, Enter continues lists, undo takes edits back", () => {
  const { view } = mount("- [ ] one", [], 9);
  const key = (k: string, mod = false) => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: mod, bubbles: true, cancelable: true }));
  key("Enter");
  expect(view.state.doc.toString()).toBe("- [ ] one\n- [ ] ");
  key("Tab");
  expect(view.state.doc.toString()).toBe("- [ ] one\n  - [ ] ");
  key("z", true);
  key("z", true);
  expect(view.state.doc.toString()).toBe("- [ ] one");
});

test("lines wrap and the selection is the browser's own", () => {
  const { view } = mount("text");
  expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
  expect(view.dom.querySelector(".cm-selectionLayer")).toBeNull();
  expect(view.dom.querySelector(".cm-cursorLayer")).toBeNull();
  expect(view.contentDOM.getAttribute("spellcheck")).toBe("true");
  expect(view.contentDOM.getAttribute("autocapitalize")).toBe("on");
  const off = new EditorView({ parent: document.body, state: EditorState.create({ extensions: coreExtensions({ spellcheck: false }) }) });
  views.push(off);
  expect(off.contentDOM.getAttribute("spellcheck")).toBe("false");
});

test("externalChange replaces only the part that differs", () => {
  expect(externalChange("same", "same")).toBeNull();
  expect(externalChange("* a\nold\n* b", "* a\nnew\n* b")).toEqual({ from: 4, to: 7, insert: "new" });
  expect(externalChange("abc", "abXc")).toEqual({ from: 2, to: 2, insert: "X" });
  // applied to an editor, the cursor and folds outside the change survive
  const { view } = mount("* a\ntext a\n* b\ntext b", [], 0);
  applyVisibility(view, "foldall");
  view.dispatch({ changes: externalChange(view.state.doc.toString(), "* a\ntext a\n* b\ntext B")! });
  expect(view.state.selection.main.head).toBe(0);
  expect(foldedRanges(view.state).size).toBe(2);
});

test("lockOuterScroll puts outer containers back at the top", () => {
  const outer = document.body.appendChild(document.createElement("div"));
  const inner = outer.appendChild(document.createElement("div"));
  const stop = lockOuterScroll(() => [outer, inner], [outer], outer, window);
  outer.scrollTop = 40;
  inner.scrollTop = 25;
  outer.dispatchEvent(new Event("scroll"));
  expect([outer.scrollTop, inner.scrollTop]).toEqual([0, 0]);
  stop();
  outer.scrollTop = 40;
  outer.dispatchEvent(new Event("scroll"));
  expect(outer.scrollTop).toBe(40);
});

test("trackKeyboard marks the view while the keyboard takes the bottom of the screen", () => {
  const vv = new EventTarget() as EventTarget & { height: number };
  const win = Object.assign(new EventTarget(), {
    innerWidth: 400, innerHeight: 780, screen: { availHeight: 800 }, visualViewport: vv,
  }) as unknown as Window & { innerHeight: number; innerWidth: number };
  vv.height = 780;
  const el = document.createElement("div");
  const stop = trackKeyboard(el, win);
  const open = () => el.classList.contains("org-keyboard-open");
  expect(open()).toBe(false);
  // Android: the window shrinks
  win.innerHeight = 450;
  win.dispatchEvent(new Event("resize"));
  expect(open()).toBe(true);
  win.innerHeight = 780;
  win.dispatchEvent(new Event("resize"));
  expect(open()).toBe(false);
  // iOS: only the visual viewport shrinks
  vv.height = 430;
  vv.dispatchEvent(new Event("resize"));
  expect(open()).toBe(true);
  vv.height = 780;
  vv.dispatchEvent(new Event("resize"));
  // turned sideways: a shorter screen without the keyboard is not the keyboard
  Object.assign(win, { innerWidth: 800, innerHeight: 380, screen: { availHeight: 400 } });
  vv.height = 380;
  win.dispatchEvent(new Event("resize"));
  expect(open()).toBe(false);
  vv.height = 200;
  vv.dispatchEvent(new Event("resize"));
  expect(open()).toBe(true);
  stop();
  expect(open()).toBe(false);
  // opened with the keyboard already up
  Object.assign(win, { innerWidth: 400, innerHeight: 450, screen: { availHeight: 800 } });
  vv.height = 450;
  const again = document.createElement("div");
  const stop2 = trackKeyboard(again, win);
  expect(again.classList.contains("org-keyboard-open")).toBe(true);
  stop2();
});

test("trackKeyboard follows the Obsidian app's keyboard events over the height", () => {
  const win = Object.assign(new EventTarget(), {
    innerWidth: 400, innerHeight: 780, screen: { availHeight: 800 }, visualViewport: null,
  }) as unknown as Window;
  const el = document.createElement("div");
  const stop = trackKeyboard(el, win);
  const open = () => el.classList.contains("org-keyboard-open");
  // the window doesn't shrink, but the app says the keyboard is up
  win.dispatchEvent(new Event("keyboardWillShow"));
  expect(open()).toBe(true);
  win.dispatchEvent(new Event("resize"));
  expect(open()).toBe(true);
  // attaching a hardware keyboard isn't the on-screen one closing
  win.dispatchEvent(Object.assign(new Event("keyboardWillHide"), { hasPhysicalKeyboard: true }));
  expect(open()).toBe(true);
  win.dispatchEvent(new Event("keyboardWillHide"));
  expect(open()).toBe(false);
  stop();
  win.dispatchEvent(new Event("keyboardWillShow"));
  expect(open()).toBe(false);
});

test("onTap runs on a still tap or a click, never on a swipe, and keeps focus away", () => {
  const el = document.body.appendChild(document.createElement("button"));
  let runs = 0;
  onTap(el, () => runs++);
  expect(mouse(el, "mousedown").defaultPrevented).toBe(true);
  expect(tap(el).defaultPrevented).toBe(true);
  expect(runs).toBe(1);
  tap(el, 30);
  expect(runs).toBe(1);
  mouse(el, "click");
  expect(runs).toBe(2);
});

// ---------------------------------------------------------------- live preview

test("markup markers hide away from the cursor and show as markers when it touches", () => {
  const doc = "Some *bold /both/* and =code= here";
  const { view } = mount(doc);
  const text = () => view.contentDOM.textContent;
  expect(text()).toBe("Some bold both and code here");
  expect(view.contentDOM.querySelector(".org-text-bold")?.textContent).toBe("bold both");
  expect(view.contentDOM.querySelector(".org-text-italic")?.textContent).toBe("both");
  expect(view.contentDOM.querySelector(".org-text-verbatim")?.textContent).toBe("code");
  view.dispatch({ selection: { anchor: doc.indexOf("bold") } });
  // only the node the cursor touches shows its markers; the nested italic stays rendered
  expect(text()).toBe("Some *bold both* and code here");
  expect(Array.from(view.contentDOM.querySelectorAll(".org-markup-marker")).map((m) => m.textContent)).toEqual(["*", "*"]);
});

test("blocks get block line classes and hide their markers away from the cursor", () => {
  const { view } = mount("#+begin_src python\nx = 1\n#+end_src\nafter");
  const first = lineEl(view, 1);
  expect(first.className).toContain("org-block-begin");
  expect(first.className).toContain("org-block-src");
  expect(first.textContent).toBe("src python");
  expect(first.querySelector(".org-block-header")?.textContent).toBe("src python");
  expect(lineEl(view, 2).className).toContain("org-block");
  expect(view.contentDOM.textContent).not.toContain("#+end_src");
  view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
  expect(view.contentDOM.textContent).toContain("#+end_src");
});

test("headings get level classes, capped at 6, and stars hide when asked", () => {
  const doc = "* TODO [#A] One :tag:\n******* Seven\nbody";
  const { view } = mount(doc, [], doc.length, { hideStars: true });
  const one = lineEl(view, 1);
  expect(one.className).toContain("HyperMD-header-1");
  expect(one.className).toContain("cm-org-level-1");
  expect(one.querySelector(".org-heading-1.cm-header-1")).not.toBeNull();
  expect(one.textContent!.startsWith("*")).toBe(false);
  expect(lineEl(view, 2).className).toContain("cm-org-level-6");
  expect(lineEl(view, 2).textContent).toBe("Seven");
  view.dispatch({ selection: { anchor: 0 } });
  expect(lineEl(view, 1).querySelector(".org-heading-stars")).not.toBeNull();
  expect(lineEl(view, 1).textContent!.startsWith("* ")).toBe(true);
  const shown = mount("* One", [], 5).view;
  expect(lineEl(shown, 1).querySelector(".org-heading-stars")?.textContent).toBe("* ");
});

test("planning, drawers, comments, keyword lines, keywords, priorities and tags get their classes", () => {
  const doc = [
    "#+author: me",
    "* DONE [#B] Task :work:",
    "SCHEDULED: <2024-01-02 Tue>",
    ":PROPERTIES:",
    ":ID: x",
    ":END:",
    ":LOGBOOK:",
    "note",
    ":END:",
    "# a comment",
    "* TODO Next",
    "end",
  ].join("\n");
  const { view } = mount(doc);
  const html = view.contentDOM;
  expect(html.querySelector(".org-meta-line")?.textContent).toBe("#+author: me");
  const done = html.querySelector(".org-keyword-done") as HTMLElement;
  expect(done.textContent).toBe("DONE");
  expect(done.className).toContain("org-keyword");
  expect(done.getAttribute("data-keyword")).toBe("DONE");
  expect(html.querySelector(".org-keyword-todo")?.textContent).toBe("TODO");
  expect(html.querySelector(".org-priority")?.textContent).toBe("[#B]");
  expect(html.querySelector(".org-tags")?.textContent).toBe(":work:");
  expect(html.querySelector(".org-planning")?.textContent).toBe("SCHEDULED: <2024-01-02 Tue>");
  expect(html.querySelector(".org-propertydrawer")?.textContent).toBe(":PROPERTIES:");
  expect(html.querySelector(".org-drawer")?.textContent).toBe(":LOGBOOK:");
  expect(html.querySelector(".org-comment")?.textContent).toBe("# a comment");
});

test("tapping a rendered link opens it; a raw link or a swipe doesn't", () => {
  const doc = "See [[id:abc][Topic]] and https://x.y here";
  const { view, opened } = mount(doc);
  const link = () => view.contentDOM.querySelector("[data-org-link]") as HTMLElement;
  expect(link().textContent).toBe("Topic");
  tap(link(), 30);
  expect(opened.links).toEqual([]);
  tap(link());
  mouse(link(), "mousedown");
  expect(opened.links).toEqual(["id:abc", "id:abc"]);
  expect(view.state.selection.main.head).toBe(doc.length);
  // the bare URL opens too while the cursor is elsewhere
  mouse(view.contentDOM.querySelectorAll("[data-org-link]")[1], "mousedown");
  expect(opened.links[2]).toBe("https://x.y");
  // with the cursor inside, the link is raw text to edit
  view.dispatch({ selection: { anchor: 8 } });
  expect(view.contentDOM.querySelector("[data-org-link='id:abc']")).toBeNull();
  expect(view.contentDOM.textContent).toContain("[[id:abc][Topic]]");
});

// ---------------------------------------------------------------- folding and dragging

test("fold arrows hang at the start of foldable lines, and there is no fold gutter", () => {
  const doc = "* a\ntext\n:LOGBOOK:\nx\n:END:\n* b\nmore\n* leaf";
  const { view } = mount(doc, [], doc.length, { hideStars: true });
  expect(view.dom.querySelector(".cm-foldGutter")).toBeNull();
  const toggle = (n: number) => lineEl(view, n).querySelector(".org-fold-toggle") as HTMLElement | null;
  expect(toggle(1)!.querySelector("svg")).not.toBeNull();
  expect(toggle(1)!.classList.contains("is-open")).toBe(true);
  // first on the line, before the (hidden) stars and the title
  expect(lineEl(view, 1).firstElementChild).toBe(toggle(1));
  expect(lineEl(view, 1).textContent).toBe("a");
  expect(toggle(3)).not.toBeNull();
  // nothing to fold, no arrow
  expect(toggle(2)).toBeNull();
  expect(toggle(8)).toBeNull();
  applyVisibility(view, "foldall");
  expect(toggle(1)!.classList.contains("is-folded")).toBe(true);
  expect(view.dom.querySelector(".cm-foldPlaceholder")?.textContent).toBe("…");
});

test("only folded headings and the cursor's line show their arrow", () => {
  const doc = "* a\ntext\n:LOGBOOK:\nx\n:END:\n* b\nmore";
  const { view } = mount(doc, [], doc.length);
  const shown = (n: number) => lineEl(view, n).querySelector(".org-fold-toggle")!.classList.contains("is-shown");
  expect(shown(1)).toBe(false);
  expect(shown(3)).toBe(false);
  view.dispatch({ selection: { anchor: 1 } });
  expect(shown(1)).toBe(true);
  view.dispatch({ selection: { anchor: doc.indexOf("* b") } });
  expect(shown(1)).toBe(false);
  expect(shown(6)).toBe(true);
  applyVisibility(view, "foldall");
  expect(shown(1)).toBe(true);
  // a folded drawer stays quiet; its … says it's folded
  applyVisibility(view, "expandall");
  view.dispatch({ selection: { anchor: doc.length } });
  tap(lineEl(view, 3).querySelector(".org-fold-toggle")!);
  expect(lineEl(view, 3).querySelector(".org-fold-toggle")!.classList.contains("is-folded")).toBe(true);
  expect(shown(3)).toBe(false);
});

test("tapping a fold arrow folds and opens it without moving the cursor or focusing", () => {
  const doc = "* a\ntext\n* b\nmore";
  const { view } = mount(doc, [], doc.length);
  const toggle = () => lineEl(view, 1).querySelector(".org-fold-toggle") as HTMLElement;
  // invisible, but still takes the tap
  expect(toggle().classList.contains("is-shown")).toBe(false);
  expect(tap(toggle()).defaultPrevented).toBe(true);
  expect(foldedRanges(view.state).size).toBe(1);
  expect(toggle().classList.contains("is-folded")).toBe(true);
  expect(view.state.selection.main.head).toBe(doc.length);
  expect(view.hasFocus).toBe(false);
  // a swipe does nothing, a mouse click opens it again
  tap(toggle(), 30);
  expect(foldedRanges(view.state).size).toBe(1);
  expect(mouse(toggle(), "mousedown").defaultPrevented).toBe(true);
  mouse(toggle(), "click");
  expect(foldedRanges(view.state).size).toBe(0);
  expect(toggle().classList.contains("is-open")).toBe(true);
});

// ---------------------------------------------------------------- front matter

const journal = ":PROPERTIES:\n:ID:       2024-01-02\n:END:\n#+title: A day\n#+filetags: :journal:\n\nBody\n";

test("the front matter panel shows the title and a row per property, and the cursor can't enter it", () => {
  const { view } = mount(journal, frontMatterPanel(), journal.length, { frontMatterPanel: true, foldPropertyDrawers: false });
  expect(view.dom.querySelector(".org-front-matter-title")?.textContent).toBe("A day");
  expect(view.dom.querySelectorAll(".org-property").length).toBe(2);
  expect(Array.from(view.dom.querySelectorAll(".org-property-key")).map((k) => k.textContent)).toEqual(["ID", "filetags"]);
  expect(view.contentDOM.textContent).not.toContain("#+title");
  // moving left from the body jumps over the whole panel
  view.dispatch({ selection: { anchor: journal.indexOf("Body") } });
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  const head = view.state.selection.main.head;
  expect(head === 0 || head >= journal.indexOf("\n\n")).toBe(true);
});

test("the panel is never part of the document, and turning it off shows the raw text", () => {
  const panel = new Compartment();
  const config = new Compartment();
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: journal,
      selection: { anchor: journal.length },
      extensions: [
        config.of(orgConfig.of({ ...DEFAULT_CONFIG, frontMatterPanel: true, foldPropertyDrawers: false })),
        coreExtensions({ spellcheck: true }),
        panel.of(frontMatterPanel()),
      ],
    }),
  });
  views.push(view);
  expect(view.state.doc.toString()).toBe(journal);
  expect(view.dom.querySelector(".org-front-matter")).not.toBeNull();
  view.dispatch({ effects: [panel.reconfigure([]), config.reconfigure(orgConfig.of({ ...DEFAULT_CONFIG, frontMatterPanel: false, foldPropertyDrawers: false }))] });
  expect(view.dom.querySelector(".org-front-matter")).toBeNull();
  expect(view.contentDOM.textContent).toContain("#+title: A day");
  expect(view.state.doc.toString()).toBe(journal);
});

// ---------------------------------------------------------------- checklists

test("checkboxes render as task checkboxes, raw only with the cursor inside", () => {
  const doc = "- [ ] open\n- [-] partly\n- [x] done\nend";
  const { view } = mount(doc);
  const boxes = Array.from(view.contentDOM.querySelectorAll("input.task-list-item-checkbox")) as HTMLInputElement[];
  expect(boxes.map((b) => b.getAttribute("data-task"))).toEqual([" ", "-", "x"]);
  expect(boxes.map((b) => [b.checked, b.indeterminate])).toEqual([[false, false], [false, true], [true, false]]);
  expect(view.contentDOM.querySelector(".org-checkbox-done")?.textContent).toBe("done");
  view.dispatch({ selection: { anchor: 3 } });
  expect(view.contentDOM.querySelectorAll("input.task-list-item-checkbox").length).toBe(2);
  expect(view.contentDOM.textContent).toContain("[ ] open");
});

test("tapping a checkbox toggles it without moving the cursor or focusing", () => {
  const doc = "- [ ] open\nend";
  const { view } = mount(doc);
  const box = () => view.contentDOM.querySelector("input.task-list-item-checkbox") as HTMLInputElement;
  tap(box());
  expect(view.state.doc.toString()).toBe("- [x] open\nend");
  mouse(box(), "click");
  expect(view.state.doc.toString()).toBe("- [ ] open\nend");
  expect(view.state.selection.main.head).toBe(doc.length);
  expect(view.hasFocus).toBe(false);
});

// ---------------------------------------------------------------- backlinks

test("tapping a backlink opens it, and a section header toggles it, without focusing", () => {
  const calls: string[] = [];
  const actions: BacklinksActions = {
    open: (path, line) => void calls.push(`open ${path}:${line}`),
    link: (m) => void calls.push(`link ${m.words}`),
    toggle: (section) => void calls.push(`toggle ${section}`),
  };
  const { view } = mount("* note\ntext", backlinksSection(actions), 0);
  view.dispatch({ effects: setBacklinks.of({
    backlinks: [{ path: "a.org", title: "A", lines: [{ line: 3, text: "see [[note]]" }] }],
    mentions: [{ path: "b.org", title: "B", line: 1, text: "a note", from: 2, to: 6, words: "note" }],
    linkedOpen: true,
    mentionsOpen: true,
  }) });
  tap(view.dom.querySelector(".org-backlinks-title")!);
  tap(view.dom.querySelector(".org-backlinks-line")!);
  tap(view.dom.querySelector(".org-backlinks-mention-text")!);
  tap(view.dom.querySelector(".org-backlinks-link-button")!);
  tap(view.dom.querySelector(".org-backlinks-header")!);
  // a file title opens at its first linking line
  expect(calls).toEqual(["open a.org:3", "open a.org:3", "open b.org:1", "link note", "toggle linked"]);
  expect(view.hasFocus).toBe(false);
  expect(view.state.selection.main.head).toBe(0);
});

// ---------------------------------------------------------------- shortcut bar

function barView(doc = "* a\ntext") {
  const ran: ButtonId[] = [];
  const bar = shortcutBar({
    buttons: BUTTONS.filter((b) => b.enabled),
    icon: (d) => d.icon,
    setIcon: (el, icon) => el.setAttribute("data-icon", icon),
    run: (id, v) => {
      ran.push(id);
      if (id === "demote") v.dispatch({ changes: { from: 0, insert: "*" } });
    },
  });
  const { view } = mount(doc, bar, 0);
  const button = (id: string) => view.dom.querySelector(`[data-button="${id}"]`) as HTMLElement;
  return { view, ran, button };
}

test("the shortcut bar is a panel at the bottom of the editor", () => {
  const { view } = barView();
  const bar = view.dom.querySelector(".org-shortcut-bar")!;
  expect(bar.closest(".cm-panels-bottom")).not.toBeNull();
  expect(view.dom.querySelector(".cm-panels-top .org-shortcut-bar")).toBeNull();
  expect(Array.from(bar.children).map((b) => b.getAttribute("data-button"))).toEqual(BUTTONS.filter((b) => b.enabled).map((b) => b.id));
});

test("bar taps keep focus where it was; editing buttons give it back, new heading takes it, swipes do nothing", () => {
  // happy-dom fires selectionchange synchronously inside CodeMirror's own
  // update; a real browser fires it later, so keep it from CodeMirror here
  const swallow = (e: Event) => e.stopImmediatePropagation();
  document.addEventListener("selectionchange", swallow, true);
  try {
    const { view, ran, button } = barView();
    tap(button("visibility"));
    tap(button("demote"));
    expect(view.hasFocus).toBe(false);
    tap(button("todo"), 30);
    expect(ran).toEqual(["visibility", "demote"]);
    view.focus();
    expect(view.hasFocus).toBe(true);
    tap(button("demote"));
    expect(view.hasFocus).toBe(true);
    view.contentDOM.blur();
    tap(button("demote"));
    expect(view.hasFocus).toBe(false);
    // new heading is pressed to start typing: it focuses even from unfocused
    tap(button("new-heading"));
    expect(view.hasFocus).toBe(true);
    // so are the block buttons
    for (const id of ["src-block", "quote-block"]) {
      view.contentDOM.blur();
      tap(button(id));
      expect(view.hasFocus).toBe(true);
    }
  } finally {
    document.removeEventListener("selectionchange", swallow, true);
  }
});

test("undo and redo are dimmed when there is nothing to undo or redo", () => {
  const { view, button } = barView();
  const dim = () => [button("undo"), button("redo")].map((b) => b.classList.contains("is-disabled"));
  expect(dim()).toEqual([true, true]);
  view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input" });
  expect(dim()).toEqual([false, true]);
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
  expect(dim()).toEqual([true, false]);
});

test("the visibility button's icon and label follow the level", () => {
  const { view, button } = barView("* a\ntext\n* b\nmore");
  const state = () => [button("visibility").getAttribute("data-icon"), button("visibility").getAttribute("aria-label")];
  expect(state()).toEqual(["unfold-vertical", "Visibility: expand all"]);
  applyVisibility(view, "foldall");
  expect(state()).toEqual(["fold-vertical", "Visibility: fold all"]);
  applyVisibility(view, "outline");
  expect(state()).toEqual(["list-tree", "Visibility: outline"]);
});

test("zoom shows only the heading's subtree, keeps the cursor inside, and grows with edits", () => {
  const doc = "intro\n* A\na\n** B\nb\n** C\nc";
  const { view } = mount(doc, [], doc.indexOf("b"));
  const visible = () => Array.from(view.contentDOM.querySelectorAll(".cm-line")).map((l) => l.textContent);
  applyVisibility(view, "foldall");
  expect(toggleZoom(view)).toBe(true);
  // the heading's own fold is opened
  expect(visible()).toEqual(["** B", "b"]);
  expect(view.dom.querySelector(".org-zoom-hidden")).not.toBeNull();
  // Ctrl+Home / select all stay inside
  view.dispatch({ selection: EditorSelection.cursor(0) });
  expect(view.state.selection.main.head).toBe(doc.indexOf("** B"));
  view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });
  expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([doc.indexOf("** B"), doc.indexOf("b") + 1]);
  // typing at the end of the zoom stays visible
  view.dispatch({ changes: { from: doc.indexOf("b") + 1, insert: "\nmore" }, selection: EditorSelection.cursor(doc.indexOf("b") + 6) });
  expect(visible()).toEqual(["** B", "b", "more"]);
  expect(view.state.doc.toString()).toBe("intro\n* A\na\n** B\nb\nmore\n** C\nc");
  expect(toggleZoom(view)).toBe(true);
  expect(view.state.field(zoomField)).toBeNull();
  expect(view.dom.querySelector(".org-zoom-hidden")).toBeNull();
  // before the first heading there is nothing to zoom into
  view.dispatch({ selection: EditorSelection.cursor(0) });
  expect(toggleZoom(view)).toBe(false);
});

test("the breadcrumbs name the file and each heading; tapping one zooms out to it", () => {
  const doc = "* Top\n** Mid\n*** Deep\nx\n* Other";
  const { view } = mount(doc, [], doc.indexOf("x"));
  toggleZoom(view);
  const crumbs = () => Array.from(view.dom.querySelectorAll(".org-zoom-crumb")).map((c) => c.textContent);
  expect(crumbs()).toEqual(["Whole file", "Top", "Mid", "Deep"]);
  expect(view.dom.querySelector(".org-zoom-crumb.is-current")?.textContent).toBe("Deep");
  tap(view.dom.querySelectorAll(".org-zoom-crumb")[2]);
  expect(crumbs()).toEqual(["Whole file", "Top", "Mid"]);
  expect(view.state.field(zoomField)).toEqual({ from: doc.indexOf("** Mid"), to: doc.indexOf("x") + 1 });
  tap(view.dom.querySelectorAll(".org-zoom-crumb")[0]);
  expect(view.state.field(zoomField)).toBeNull();
  expect(view.dom.querySelector(".org-zoom-bar")).toBeNull();
});

test("jumping to hidden text zooms out; the zoom button shows when zoomed", () => {
  const doc = "* A\na\n* B\nb";
  const { view } = mount(doc, shortcutBar({ buttons: BUTTONS, icon: (d) => d.icon, setIcon() {}, run: (_id, v) => void toggleZoom(v) }), 1);
  const zoom = view.dom.querySelector('[data-button="zoom"]')!;
  tap(zoom);
  expect(zoom.classList.contains("is-active")).toBe(true);
  expect(revealZoomEffects(view.state, 2)).toEqual([]);
  view.dispatch({ effects: revealZoomEffects(view.state, doc.indexOf("b")), selection: EditorSelection.cursor(doc.indexOf("b")) });
  expect(view.state.field(zoomField)).toBeNull();
  expect(view.state.selection.main.head).toBe(doc.indexOf("b"));
  expect(zoom.classList.contains("is-active")).toBe(false);
});

test("an ID link to a heading opens it zoomed in, even from another zoom; a file ID doesn't zoom", () => {
  const doc = ":PROPERTIES:\n:ID: f\n:END:\n* A\na\n** A1\nx\n* B\n:PROPERTIES:\n:ID: b\n:END:\nb";
  const { view } = mount(doc, [], 1);
  applyVisibility(view, "foldall");
  expect(zoomToHeadingAt(view, doc.indexOf("** A1"))).toBe(true);
  expect(view.state.field(zoomField)).toEqual({ from: doc.indexOf("** A1"), to: doc.indexOf("* B") - 1 });
  expect(zoomToHeadingAt(view, doc.indexOf("* B"))).toBe(true);
  expect(view.state.field(zoomField)).toEqual({ from: doc.indexOf("* B"), to: doc.length });
  expect(view.state.selection.main.head).toBe(doc.indexOf("* B"));
  const b = view.state.doc.lineAt(doc.indexOf("* B"));
  let covered = false;
  foldedRanges(view.state).between(b.from, b.to, (from, to) => { if (from <= b.to && to >= b.from) covered = true; });
  expect(covered).toBe(false);
  expect(zoomToHeadingAt(view, 0)).toBe(false);
});
