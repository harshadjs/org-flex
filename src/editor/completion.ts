// LP-9: typing `[[` offers notes and headings by title (picking one inserts
// an ID link with the title as description) and files without an ID;
// `[[id:` offers every raw org ID. LP-10: a title nobody has yet can be
// picked to create the note.

import { autocompletion, Completion as CmCompletion, CompletionContext, CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { linkDescription } from "../org/vault-index";
import { offerCreate } from "../org/new-note";
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

export function linkCompletions(context: CompletionContext): CompletionResult | null {
  const host = context.state.facet(orgHost);
  if (!host) return null;
  const before = context.matchBefore(/\[\[[^\[\]]*/);
  if (!before) return null;
  const typed = before.text.slice(2);
  const isId = /^id:/i.test(typed);
  const from = before.from + 2 + (isId ? 3 : 0);
  const items = isId ? host.idCompletions() : host.linkCompletions();
  const options: CmCompletion[] = items.map((item) => ({
    label: item.label,
    detail: item.detail,
    type: item.type,
    apply: insertLink(linkBody(item)),
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
      apply: (view, c, f, t) => insertLink(linkBody({ target: `id:${createNote(title)}`, description: linkDescription(title) }))(view, c, f, t),
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

export function orgCompletion() {
  return autocompletion({ override: [linkCompletions], icons: false });
}
