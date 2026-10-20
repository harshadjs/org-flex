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
import { orgZoom } from "./zoom";

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
    orgZoom(),
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

/**
 * BAR-1: keep `cls` on `el` while the on-screen keyboard is open. The Obsidian
 * app says so with `keyboardWillShow` / `keyboardWillHide` window events (the
 * ones it hides its own navigation bar on). Before the first of those, and
 * where there are none, the keyboard counts as open when the visible height
 * is under 3/4 of the tallest seen at this width (Android shrinks the window,
 * iOS the visual viewport; the screen's height is the first guess, so a view
 * opened with the keyboard up knows it too). Returns a function that removes
 * the listeners.
 */
export function trackKeyboard(el: Element, win: Window, cls = "org-keyboard-open"): () => void {
  let width = -1;
  let tallest = 0;
  let told = false;
  const show = () => {
    told = true;
    el.classList.add(cls);
  };
  const hide = (e: Event) => {
    // a hardware keyboard being attached isn't the on-screen one going away
    if ((e as Event & { hasPhysicalKeyboard?: boolean }).hasPhysicalKeyboard) return;
    told = true;
    el.classList.remove(cls);
  };
  const update = () => {
    if (told) return;
    const height = Math.min(win.innerHeight, win.visualViewport?.height ?? win.innerHeight);
    if (win.innerWidth !== width) {
      // turned: start again from the screen's height
      width = win.innerWidth;
      tallest = win.screen?.availHeight ?? 0;
    }
    tallest = Math.max(tallest, height);
    el.classList.toggle(cls, height < tallest * 0.75);
  };
  update();
  win.addEventListener("keyboardWillShow", show);
  win.addEventListener("keyboardWillHide", hide);
  win.addEventListener("resize", update);
  win.visualViewport?.addEventListener("resize", update);
  return () => {
    win.removeEventListener("keyboardWillShow", show);
    win.removeEventListener("keyboardWillHide", hide);
    win.removeEventListener("resize", update);
    win.visualViewport?.removeEventListener("resize", update);
    el.classList.remove(cls);
  };
}
