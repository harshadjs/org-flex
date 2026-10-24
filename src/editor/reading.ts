// Reading mode (§2b): the text can't be edited and the keyboard never comes
// up, but checkboxes, TODO keywords and planning dates still respond to taps.

import { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { toggleKeyword } from "../org/edit";
import type { PlanningKind } from "../org/edit";
import { Keywords } from "../org/syntax";
import { allowInReading } from "./state";

export interface ReadingActions {
  keywords(): Keywords;
  /** open the date picker for the heading the planning line at `pos` belongs to */
  pickDate(kind: PlanningKind, pos: number): void;
}

/** RD-2: only edits marked `allowInReading`, and changes on disk, get through. */
const blockEdits = EditorState.transactionFilter.of((tr) =>
  !tr.docChanged || tr.annotation(allowInReading) || tr.isUserEvent("external")
    ? tr
    : { effects: tr.effects });

/** RD-3, RD-4: taps on keywords and dates, without moving the cursor. A touch that moved is a scroll. */
function taps(actions: ReadingActions): Extension {
  const selector = ".org-keyword[data-keyword], .org-planning-date[data-org-date]";
  let start: { x: number; y: number; el: Element } | null = null;
  const targetOf = (e: Event) => (e.target as HTMLElement | null)?.closest?.(selector) ?? null;
  const act = (view: EditorView, el: Element) => {
    const pos = view.posAtDOM(el);
    const kind = el.getAttribute("data-org-date");
    if (kind === "SCHEDULED" || kind === "DEADLINE") {
      actions.pickDate(kind, pos);
      return;
    }
    const spec = toggleKeyword(view.state, pos, actions.keywords());
    if (spec) view.dispatch(spec, { annotations: allowInReading.of(true) });
  };
  return EditorView.domEventHandlers({
    touchstart(e) {
      const el = targetOf(e);
      const t = e.touches[0];
      start = el && t ? { x: t.clientX, y: t.clientY, el } : null;
      return false;
    },
    touchend(e, view) {
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      if (!s || !t || targetOf(e) !== s.el) return false;
      if (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10) return false;
      e.preventDefault();
      act(view, s.el);
      return true;
    },
    mousedown(e, view) {
      const el = targetOf(e);
      if (!el || e.button !== 0) return false;
      e.preventDefault();
      act(view, el);
      return true;
    },
  });
}

/** RD-1..4: the extension for a view in reading mode. */
export function readingMode(actions: ReadingActions): Extension {
  return [
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    EditorView.editorAttributes.of({ class: "org-reading" }),
    blockEdits,
    taps(actions),
  ];
}
