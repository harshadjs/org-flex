// Shared editor state: the plugin's settings as a facet, callbacks into
// Obsidian (the host), and the document's line structure, kept up to date in
// a state field so every extension reads the same analysis.

import { Annotation, EditorState, Facet, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { analyze, Keywords, OrgStructure } from "../org/syntax";
import { FrontMatter, parseFrontMatter } from "../org/front-matter";

export interface OrgConfig {
  keywords: Keywords;
  hideStars: boolean;
  foldPropertyDrawers: boolean;
  frontMatterPanel: boolean;
}

export const DEFAULT_CONFIG: OrgConfig = {
  keywords: { todo: ["TODO"], done: ["DONE"] },
  hideStars: false,
  foldPropertyDrawers: true,
  frontMatterPanel: false,
};

export const orgConfig = Facet.define<OrgConfig, OrgConfig>({
  combine: (values) => values[0] ?? DEFAULT_CONFIG,
});

/** LP-9: one entry of the `[[` list. */
export interface Completion {
  /** what the list shows and matches */
  label: string;
  detail?: string;
  /** the link target to insert: `id:<id>`, a file, or an ID */
  target: string;
  /** inserted as the link's description when present */
  description?: string;
  type?: string;
}

/** What the editor needs from Obsidian. */
export interface OrgHost {
  setIcon(el: HTMLElement, icon: string): void;
  openLink(target: string, view: EditorView): void;
  /** a URL for an image link target, or null to use the target as is */
  imageSrc(target: string): string | null;
  /** after `[[`: notes and headings by title, then files without an ID */
  linkCompletions(): Completion[];
  /** after `[[id:`: every raw ID */
  idCompletions(): Completion[];
  /**
   * LP-10: start creating a note titled `title` and return its new ID
   * straight away; the file is written in the background.
   */
  createNote?(title: string): string;
  /** ZOOM-2: the file's title, for the first breadcrumb */
  title?(): string;
}

export const orgHost = Facet.define<OrgHost, OrgHost | null>({
  combine: (values) => values[0] ?? null,
});

export interface DocInfo {
  structure: OrgStructure;
  /** front matter, or null when there is none or the panel is off */
  frontMatter: FrontMatter | null;
}

function lines(state: EditorState, limit = Infinity): string[] {
  const result: string[] = [];
  for (const line of state.doc.iterLines()) {
    if (result.length >= limit) break;
    result.push(line);
  }
  return result;
}

function compute(state: EditorState): DocInfo {
  const config = state.facet(orgConfig);
  const all = lines(state);
  return {
    structure: analyze(all),
    frontMatter: config.frontMatterPanel ? parseFrontMatter(all.slice(0, 500)) : null,
  };
}

export const docInfo = StateField.define<DocInfo>({
  create: compute,
  update(value, tr) {
    if (tr.docChanged || tr.startState.facet(orgConfig) !== tr.state.facet(orgConfig)) return compute(tr.state);
    return value;
  },
});

export function structureOf(state: EditorState): OrgStructure {
  return state.field(docInfo).structure;
}

/** Whether any selection range touches [from, to] (ends included). */
/** RD-2: marks the few edits that reading mode lets through (checkboxes, keyword and date taps). */
export const allowInReading = Annotation.define<boolean>();

export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** How long a press has to be held to count as a long press (MOB-7). */
export const LONG_PRESS_MS = 500;

/**
 * Run `action` on a tap or click without moving the cursor, focusing the
 * editor or bringing up the mobile keyboard (MOB-7). A touch that moved
 * (a scroll or swipe) is not a tap. With `onLong`, holding the press still
 * for LONG_PRESS_MS runs that instead, and the tap that ends it does nothing.
 */
export function onTap(el: HTMLElement, action: (e: Event) => void, onLong?: () => void) {
  let start: { x: number; y: number } | null = null;
  let timer: number | null = null;
  let long = false;
  const stop = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const hold = () => {
    long = false;
    stop();
    if (!onLong) return;
    timer = window.setTimeout(() => {
      timer = null;
      long = true;
      navigator.vibrate?.(15);
      onLong();
    }, LONG_PRESS_MS);
  };
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (e.button === 0) hold();
  });
  el.addEventListener("mouseup", stop);
  el.addEventListener("mouseleave", stop);
  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    start = t ? { x: t.clientX, y: t.clientY } : null;
    hold();
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (start && t && (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10)) stop();
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    stop();
    const t = e.changedTouches[0];
    const s = start;
    start = null;
    if (long) {
      e.preventDefault();
      return;
    }
    if (!s || !t || Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10) return;
    // no synthetic mouse events, no click, no focus
    e.preventDefault();
    action(e);
  });
  el.addEventListener("click", (e) => {
    e.preventDefault();
    if (long) {
      long = false;
      return;
    }
    action(e);
  });
  // a long press on a phone would otherwise open the context menu
  if (onLong) el.addEventListener("contextmenu", (e) => e.preventDefault());
}
