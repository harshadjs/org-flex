// LP-9: typing `[[` offers notes and headings by title (picking one inserts
// an ID link with the title as description) and files without an ID;
// `[[id:` offers every raw org ID.

import { autocompletion, Completion as CmCompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
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

export function linkCompletions(context: CompletionContext): CompletionResult | null {
  const host = context.state.facet(orgHost);
  if (!host) return null;
  const before = context.matchBefore(/\[\[[^\[\]]*/);
  if (!before) return null;
  const typed = before.text.slice(2);
  const isId = /^id:/i.test(typed);
  const from = before.from + 2 + (isId ? 3 : 0);
  const items = isId ? host.idCompletions() : host.linkCompletions();
  return {
    from,
    validFor: /^[^\[\]]*$/,
    options: items.map((item) => ({
      label: item.label,
      detail: item.detail,
      type: item.type,
      apply: insertLink(linkBody(item)),
    })),
  };
}

export function orgCompletion() {
  return autocompletion({ override: [linkCompletions], icons: false });
}
