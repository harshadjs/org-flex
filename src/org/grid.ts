// The notes grid (§11c): every org file as a card, as Google Keep shows
// notes: pinned first, then the most recently changed, in columns of cards of
// varying height, narrowed by labels (`#+filetags`) and a search. Pin and
// colour are `#+pinned` and `#+color` lines in the note. Pure: works on index
// records and text, so it is tested directly.

import type { NoteRecord } from "./vault-index";

/** GRID-5: the colours a card can take, as Keep has them */
export const GRID_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "darkblue", "purple", "pink", "brown", "gray"] as const;
export type GridColor = (typeof GRID_COLORS)[number];

/** GRID-3: one line of a card's text */
export interface PreviewLine {
  kind: "heading" | "text" | "item" | "check" | "checked";
  text: string;
  /** a list item's depth, from 0 */
  depth: number;
}

export interface GridCard {
  path: string;
  title: string;
  /** GRID-6: `#+filetags`, in order, each once */
  tags: string[];
  pinned: boolean;
  color: GridColor | null;
  /** GRID-3: the opening lines of the text, and whether there is more */
  preview: PreviewLine[];
  more: boolean;
  /** when the file last changed (ms) */
  mtime: number;
  /** GRID-7: the title and text, lower case, for the search */
  haystack: string;
}

/** GRID-3: lines a card shows at most */
export const PREVIEW_LINES = 12;

const HEADING_RE = /^(\*+)[ \t]+(.*)$/;
const KEYWORD_RE = /^[ \t]*#\+([A-Za-z_][\w-]*):[ \t]*(.*)$/;

/** The 0-based lines before the first heading: where a note's `#+` keywords are. */
function headerEnd(lines: string[]): number {
  const n = lines.findIndex((l) => HEADING_RE.test(l));
  return n < 0 ? lines.length : n;
}

/** GRID-4: the value of `#+key:` before the first heading (the first such line), or null. */
export function headerKeyword(text: string, key: string): string | null {
  const lines = text.split("\n");
  const end = headerEnd(lines);
  for (let n = 0; n < end; n++) {
    const m = KEYWORD_RE.exec(lines[n]);
    if (m && m[1].toLowerCase() === key.toLowerCase()) return m[2].trim();
  }
  return null;
}

/** GRID-6: `#+filetags` before the first heading, every such line, each tag once. */
export function fileTagsOf(text: string): string[] {
  const lines = text.split("\n");
  const end = headerEnd(lines);
  const tags: string[] = [];
  for (let n = 0; n < end; n++) {
    const m = KEYWORD_RE.exec(lines[n]);
    if (m && m[1].toLowerCase() === "filetags") tags.push(...m[2].split(/[:\s]+/).filter(Boolean));
  }
  return [...new Set(tags)];
}

/** GRID-4: `#+pinned:` says yes (`t`, `yes`, `true`, `1`, any case). */
export function isPinned(value: string | null): boolean {
  return !!value && /^(t|yes|true|1)$/i.test(value.trim());
}

/** GRID-5: a known colour name (any case), or null. */
export function gridColor(value: string | null): GridColor | null {
  const v = value?.trim().toLowerCase();
  return (GRID_COLORS as readonly string[]).includes(v ?? "") ? (v as GridColor) : null;
}

const DRAWER_RE = /^[ \t]*:([\w-]+):[ \t]*$/;
const END_RE = /^[ \t]*:END:[ \t]*$/i;
const PLANNING_RE = /^[ \t]*(SCHEDULED|DEADLINE|CLOSED):/;
const COMMENT_RE = /^[ \t]*#( |$)/;
const ITEM_RE = /^([ \t]*)(?:[-+]|\d+[.)])[ \t]+(?:\[([ xX-])\][ \t]+)?(.*)$/;

/**
 * GRID-3: the note's opening lines as a card shows them: no drawers, `#+`
 * lines, planning lines or comments; headings without their stars and tags;
 * list items and checkboxes marked; runs of blank lines as one, none at the
 * start or end. At most `max` lines, and whether anything was left out.
 */
export function previewLines(text: string, max = PREVIEW_LINES): { lines: PreviewLine[]; more: boolean } {
  const out: PreviewLine[] = [];
  let blank = false;
  let drawer = false;
  for (const raw of text.split("\n")) {
    if (drawer) {
      if (END_RE.test(raw)) drawer = false;
      continue;
    }
    if (DRAWER_RE.test(raw) && !END_RE.test(raw)) {
      drawer = true;
      continue;
    }
    if (KEYWORD_RE.test(raw) || /^[ \t]*#\+/.test(raw) || PLANNING_RE.test(raw) || COMMENT_RE.test(raw)) continue;
    if (!raw.trim()) {
      blank = out.length > 0;
      continue;
    }
    let line: PreviewLine;
    const h = HEADING_RE.exec(raw);
    const item = ITEM_RE.exec(raw);
    if (h) line = { kind: "heading", text: h[2].replace(/[ \t]+:[\w@#%:]+:[ \t]*$/, "").trim(), depth: 0 };
    else if (item) {
      const box = item[2];
      line = { kind: box === undefined ? "item" : box === " " || box === "-" ? "check" : "checked", text: item[3].trim(), depth: Math.floor(item[1].replace(/\t/g, "  ").length / 2) };
    } else line = { kind: "text", text: raw.trim(), depth: 0 };
    if (blank && out.length < max) out.push({ kind: "text", text: "", depth: 0 });
    blank = false;
    if (out.length >= max) return { lines: out, more: true };
    out.push(line);
  }
  return { lines: out, more: false };
}

/** GRID-2: a card for an indexed note, changed at `mtime`. */
export function readCard(note: NoteRecord, mtime: number): GridCard {
  const { lines, more } = previewLines(note.text);
  return {
    path: note.path,
    title: note.title,
    tags: fileTagsOf(note.text),
    pinned: isPinned(headerKeyword(note.text, "pinned")),
    color: gridColor(headerKeyword(note.text, "color")),
    preview: lines,
    more,
    mtime,
    haystack: `${note.title}\n${note.text}`.toLowerCase(),
  };
}

/** GRID-2: pinned first, then the most recently changed, then by title. */
export function sortCards(cards: GridCard[]): GridCard[] {
  return [...cards].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.mtime - a.mtime || a.title.localeCompare(b.title));
}

/** GRID-6, GRID-7: what the grid is narrowed by */
export interface GridFilter {
  text: string;
  /** chosen labels (tags) */
  tags: string[];
  /** chosen hidden folders (GRID-8) */
  folders: string[];
}

export const NO_GRID_FILTER: GridFilter = { text: "", tags: [], folders: [] };

/** GRID-7: a saved filter, cleaned: anything that isn't text is dropped. */
export function cleanGridFilter(raw: unknown): GridFilter {
  if (!raw || typeof raw !== "object") return NO_GRID_FILTER;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))] : []);
  return { text: typeof r.text === "string" ? r.text : "", tags: strings(r.tags), folders: strings(r.folders) };
}

/** GRID-8: the hidden folder `path` is in (its first folder that is, as `folders` names them), or null. */
export function hiddenFolder(path: string, folders: readonly string[]): string | null {
  for (const f of folders) {
    const folder = f.replace(/\/+$/, "");
    if (folder && path.startsWith(`${folder}/`)) return folder;
  }
  return null;
}

/**
 * GRID-6..8: the cards that show. With nothing chosen, every card outside the
 * hidden folders. With chips chosen, the cards matching any of them: a card in
 * a chosen hidden folder, or one outside the hidden folders carrying a chosen
 * label. Then only those holding every word typed, in the title or text.
 */
export function filterCards(cards: GridCard[], filter: GridFilter, hidden: readonly string[]): GridCard[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  const chosen = filter.tags.length + filter.folders.length > 0;
  return cards.filter((card) => {
    const folder = hiddenFolder(card.path, hidden);
    const shown = !chosen
      ? folder === null
      : folder !== null
        ? filter.folders.includes(folder)
        : card.tags.some((t) => filter.tags.includes(t));
    return shown && words.every((w) => card.haystack.includes(w));
  });
}

/** GRID-6: every label on the cards outside the hidden folders, with how many carry it, most first, then by name. */
export function gridLabels(cards: GridCard[], hidden: readonly string[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (hiddenFolder(card.path, hidden) !== null) continue;
    for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** GRID-2: how many columns fit `width` pixels: cards at least 200 wide, at least 2, at most 6. */
export function gridColumns(width: number): number {
  return Math.max(2, Math.min(6, Math.floor((width + 12) / (200 + 12))));
}

/** GRID-2: a card's height in lines, roughly: its title and its text. */
export function cardLines(card: GridCard): number {
  return 2 + card.preview.length + (card.more ? 1 : 0);
}

/**
 * GRID-2: the cards in `columns` columns, in order, each card going to the
 * column that is shortest so far (the leftmost of equals), so the order reads
 * across and down as in Keep. Returns each column's indices.
 */
export function masonry(heights: number[], columns: number): number[][] {
  const cols: number[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const sum = cols.map(() => 0);
  heights.forEach((h, i) => {
    let c = 0;
    for (let k = 1; k < cols.length; k++) if (sum[k] < sum[c]) c = k;
    cols[c].push(i);
    sum[c] += h;
  });
  return cols;
}

/**
 * GRID-4..6: the note's text with `#+key:` set to `value`, or removed when
 * null. An existing line (the first before the first heading) is replaced,
 * keeping how its key is written, and any more of them removed; a new one goes
 * after the last `#+` line before the first heading, else after the property
 * drawer the file starts with, else at the top.
 */
export function setKeyword(text: string, key: string, value: string | null): string {
  const lines = text.split("\n");
  const end = headerEnd(lines);
  const k = key.toLowerCase();
  let found = -1;
  let lastKeyword = -1;
  const remove: number[] = [];
  for (let n = 0; n < end; n++) {
    const m = KEYWORD_RE.exec(lines[n]);
    if (!m) continue;
    lastKeyword = n;
    if (m[1].toLowerCase() !== k) continue;
    if (found < 0) found = n;
    else remove.push(n);
  }
  for (const n of remove.reverse()) lines.splice(n, 1);
  if (found >= 0) {
    if (value === null) lines.splice(found, 1);
    else lines[found] = `#+${KEYWORD_RE.exec(lines[found])![1]}: ${value}`;
    return lines.join("\n");
  }
  if (value === null) return text;
  let at = lastKeyword + 1;
  if (lastKeyword < 0) {
    at = 0;
    if (/^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[0] ?? "")) {
      const close = lines.findIndex((l, n) => n > 0 && END_RE.test(l));
      if (close > 0) at = close + 1;
    }
  }
  lines.splice(at, 0, `#+${k}: ${value}`);
  return lines.join("\n");
}

/** GRID-6: the note's text with `#+filetags` set to `tags` (`:a:b:`), or removed when there are none. */
export function setFileTags(text: string, tags: string[]): string {
  const unique = [...new Set(tags)];
  return setKeyword(text, "filetags", unique.length ? `:${unique.join(":")}:` : null);
}

/** GRID-6: a label typed by hand, as an Org tag: trimmed, spaces as `_`; null if it has characters a tag can't. */
export function cleanLabel(typed: string): string | null {
  const tag = typed.trim().replace(/^:+|:+$/g, "").replace(/\s+/g, "_");
  return /^[\p{L}\p{N}_@#%]+$/u.test(tag) ? tag : null;
}
