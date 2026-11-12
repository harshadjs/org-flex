// Formatting (ACT-17): bold, italic, code, verbatim, strike-through and
// underline, toggled on the selection or the word at the cursor, as the
// shortcut bar's Format group and the format commands do it. Pure: works on
// EditorState, so it is tested directly.

import { EditorSelection, EditorState, TransactionSpec } from "@codemirror/state";
import { InlineNode, MARKERS, MarkupNode, MarkupType, parseInline } from "./syntax";

/** ACT-17: the character that marks each kind of emphasis */
export const MARKER_OF = Object.fromEntries(Object.entries(MARKERS).map(([m, t]) => [t, m])) as Record<MarkupType, string>;

function markupNodes(nodes: InlineNode[], out: MarkupNode[] = []): MarkupNode[] {
  for (const node of nodes) {
    if (node.type === "link") continue;
    out.push(node);
    markupNodes(node.children, out);
  }
  return out;
}

/** ACT-17: the kinds of emphasis around the cursor (the main selection's head), for the bar's active buttons. */
export function activeMarkup(state: EditorState): Set<MarkupType> {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const at = head - line.from;
  return new Set(markupNodes(parseInline(line.text)).filter((n) => n.from + 1 <= at && at <= n.to - 1).map((n) => n.type));
}

const WORD = /[\p{L}\p{N}'’-]/u;

/**
 * ACT-17: toggle `type` on the selection, or at the cursor. Inside text that
 * already has it (the selection within one such span, or exactly over it with
 * its markers), its markers go.
 * Otherwise a selection on one line is wrapped (spaces at its ends left
 * outside) and stays on the text; with no selection, the word at the cursor is
 * wrapped and the cursor stays in it, or, between words, an empty pair is
 * inserted with the cursor inside. A selection over several lines does nothing.
 */
export function toggleMarkup(state: EditorState, type: MarkupType): TransactionSpec | null {
  const marker = MARKER_OF[type];
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  if (sel.to > line.to) return null;
  const text = line.text;
  const a = sel.from - line.from;
  const b = sel.to - line.from;
  const userEvent = "input.format";

  // the innermost span of this kind holding the selection (inside its markers)
  const span = markupNodes(parseInline(text))
    .filter((n) => n.type === type && ((n.from + 1 <= a && b <= n.to - 1) || (a === n.from && b === n.to)))
    .sort((x, y) => x.to - x.from - (y.to - y.from))[0];
  if (span) {
    const changes = state.changes([
      { from: line.from + span.from, to: line.from + span.from + 1 },
      { from: line.from + span.to - 1, to: line.from + span.to },
    ]);
    return { changes, selection: EditorSelection.range(changes.mapPos(sel.anchor, 1), changes.mapPos(sel.head, 1)), userEvent };
  }

  if (a < b) {
    let from = a;
    let to = b;
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
    if (from === to) return null;
    return {
      changes: [{ from: line.from + from, insert: marker }, { from: line.from + to, insert: marker }],
      selection: EditorSelection.range(line.from + from + 1, line.from + to + 1),
      userEvent,
    };
  }

  let from = a;
  let to = a;
  while (from > 0 && WORD.test(text[from - 1])) from--;
  while (to < text.length && WORD.test(text[to])) to++;
  if (from === to) {
    return { changes: { from: sel.head, insert: marker + marker }, selection: EditorSelection.cursor(sel.head + 1), userEvent };
  }
  return {
    changes: [{ from: line.from + from, insert: marker }, { from: line.from + to, insert: marker }],
    selection: EditorSelection.cursor(sel.head + 1),
    userEvent,
  };
}
