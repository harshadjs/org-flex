// The editor's core setup (§2) and the pieces of the view that need no
// Obsidian, kept here so they can be tested: the extensions every org editor
// gets, the minimal edit for a change on disk, and the outer scroll lock.

import { ChangeSpec, Extension } from "@codemirror/state";
import { EditorView, keymap, scrollPastEnd } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { docInfo } from "./state";
import { livePreview } from "./preview";
import { srcHighlight } from "./src-highlight";
import { orgFolding } from "./folding";
import { checklists } from "./checklists";
import { orgCompletion } from "./completion";

/** PLAT-3: the view type, which is also the plugin id. */
export const VIEW_TYPE = "org-flex";

/**
 * VIEW-4, VIEW-6, VIEW-8: history, keys, wrapping, scroll past the end,
 * native selection, spellcheck, and the org features every editor has.
 */
export function coreExtensions(options: { spellcheck: boolean }): Extension {
  return [
    docInfo,
    history(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.lineWrapping,
    scrollPastEnd(),
    EditorView.contentAttributes.of(options.spellcheck
      ? { spellcheck: "true", autocorrect: "on", autocapitalize: "on" }
      : { spellcheck: "false" }),
    livePreview(),
    srcHighlight,
    orgFolding(),
    checklists(),
    orgCompletion(),
  ];
}

/** VIEW-9: one change covering only the part of `old` that differs from `next`, or null when equal. */
export function externalChange(old: string, next: string): ChangeSpec | null {
  if (old === next) return null;
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let end = 0;
  while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++;
  return { from: start, to: old.length - end, insert: next.slice(start, next.length - end) };
}

/**
 * MOB-4: keep the outer containers at scrollTop 0, on their scroll, the
 * document's scroll, focus inside `focusRoot` and visual viewport resizes.
 * Returns a function that removes the listeners.
 */
export function lockOuterScroll(
  targets: () => (Element | null | undefined)[],
  scrollers: Element[],
  focusRoot: Element,
  win: Window,
): () => void {
  const reset = () => {
    for (const el of targets()) if (el && el.scrollTop !== 0) el.scrollTop = 0;
  };
  const later = () => win.setTimeout(reset, 0);
  const doc = win.document;
  for (const el of scrollers) el.addEventListener("scroll", reset);
  doc.addEventListener("scroll", reset);
  focusRoot.addEventListener("focusin", later);
  const vv = win.visualViewport;
  vv?.addEventListener("resize", reset);
  return () => {
    for (const el of scrollers) el.removeEventListener("scroll", reset);
    doc.removeEventListener("scroll", reset);
    focusRoot.removeEventListener("focusin", later);
    vv?.removeEventListener("resize", reset);
  };
}
