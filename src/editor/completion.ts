// LP-9: typing `[[` offers notes and headings by title (picking one inserts
// an ID link with the title as description) and files without an ID;
// `[[id:` offers every raw org ID. LP-10: a title nobody has yet can be
// picked to create the note. ACT-9: the link button links selected words.

import { autocompletion, Completion as CmCompletion, CompletionContext, CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection, StateEffect, StateField, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { linkDescription } from "../org/vault-index";
import { offerCreate } from "../org/new-note";
import { insertWikiLink } from "../org/edit";
import { Completion, orgHost } from "./state";

/** LP-9: the text that goes between `[[` and `]]` for a picked entry. */
export function linkBody(item: Pick<Completion, "target" | "description">): string {
  return item.description ? `${item.target}][${item.description}` : item.target;
}

/** Replaces what was typed (and a closing `]]` already there) and leaves the cursor after the link. */
function insertLink(body: string) {
  return (view: EditorView, _c: CmCompletion, from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to;
    const insert = `${body}]]`;
    view.dispatch({
      changes: { from, to: end, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.complete",
    });
  };
}

const CREATE_SECTION = {
  name: "create",
  header: () => {
    const el = document.createElement("completion-section");
    el.className = "org-completion-section";
    return el;
  },
};

/** ACT-9: selected words turned into a `[[words` query: where the `[[` is, and the words. */
const setLinkWords = StateEffect.define<{ from: number; words: string } | null>();
const linkWordsField = StateField.define<{ from: number; words: string } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLinkWords)) return e.value;
    return value && tr.docChanged ? { from: tr.changes.mapPos(value.from, 1), words: value.words } : value;
  },
});

export function linkCompletions(context: CompletionContext): CompletionResult | null {
  const host = context.state.facet(orgHost);
  if (!host) return null;
  const before = context.matchBefore(/\[\[[^\[\]]*/);
  if (!before) return null;
  const typed = before.text.slice(2);
  const scheme = /^(id|denote):/i.exec(typed);
  const isId = scheme !== null;
  const from = before.from + 2 + (scheme ? scheme[0].length : 0);
  const items = scheme ? host.idCompletions(scheme[1].toLowerCase() as "id" | "denote") : host.linkCompletions();
  // ACT-9: still the selected words, untouched: an ID link keeps them as its text
  const pending = context.state.field(linkWordsField, false);
  const words = pending && pending.from === before.from && pending.words === typed ? linkDescription(typed) : null;
  const options: CmCompletion[] = items.map((item) => ({
    label: item.label,
    detail: item.detail,
    type: item.type,
    apply: insertLink(linkBody(words && item.description !== undefined ? { ...item, description: words } : item)),
  }));
  const title = typed.trim();
  const create = !isId && host.createNote && offerCreate(items.map((i) => i.label), typed);
  if (create) {
    const createNote = host.createNote!.bind(host);
    options.push({
      label: typed,
      detail: "Create note",
      type: "create",
      // any option in a section sorts after those without one: this one is always last
      section: CREATE_SECTION,
      apply: (view, c, f, t) => insertLink(linkBody({ target: createNote(title), description: linkDescription(title) }))(view, c, f, t),
    });
  }
  return {
    from,
    // the create entry follows what's typed, so the list is worked out again on every key
    validFor: host.createNote && !isId ? undefined : /^[^\[\]]*$/,
    options,
  };
}

/**
 * LP-9: insert a link from a button or command and open the list straight
 * away. The list only opens by itself on typing, and a button isn't typing.
 */
export function insertLinkWithCompletion(view: EditorView, spec: TransactionSpec) {
  view.dispatch(spec);
  startCompletion(view);
}

/** ACT-9: the ID entries (notes and headings) whose title is exactly `words`, ignoring case and spaces around them. */
export function exactIdMatches(items: Completion[], words: string): Completion[] {
  const want = words.trim().toLowerCase();
  return want ? items.filter((i) => /^(id|denote):/.test(i.target) && i.label.trim().toLowerCase() === want) : [];
}

/**
 * ACT-9: the link button. No selection: `[[]]` and the list. A selection on
 * one line: an ID link straight away when exactly one note or heading has
 * that title, else `[[words]]` with the list open on the words. A selection
 * over several lines, or with brackets, is wrapped as `[[selection]]`.
 */
export function linkButton(view: EditorView) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  const host = state.facet(orgHost);
  if (from === to || !host || /[\n\[\]]/.test(text) || !text.trim()) {
    if (from === to) insertLinkWithCompletion(view, insertWikiLink(state));
    else view.dispatch(insertWikiLink(state));
    return;
  }
  // spaces around the words stay outside the link
  const lead = text.length - text.trimStart().length;
  const words = text.trim();
  const start = from + lead;
  const end = start + words.length;
  const matches = exactIdMatches(host.linkCompletions(), words);
  if (matches.length === 1) {
    const insert = `[[${linkBody({ target: matches[0].target, description: linkDescription(words) })}]]`;
    view.dispatch({ changes: { from: start, to: end, insert }, selection: EditorSelection.cursor(start + insert.length), userEvent: "input" });
    return;
  }
  view.dispatch({
    changes: { from: start, to: end, insert: `[[${words}]]` },
    selection: EditorSelection.cursor(start + 2 + words.length),
    effects: setLinkWords.of({ from: start, words }),
    userEvent: "input",
  });
  startCompletion(view);
}

export function orgCompletion() {
  return [linkWordsField, autocompletion({ override: [linkCompletions], icons: false })];
}
