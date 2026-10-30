// The timeline (§11b): every org-roam node by the time its ID was made,
// newest first, with the attachments each one links to.

import { analyze } from "./syntax";
import { isMediaFile, type NoteRecord } from "./vault-index";

/**
 * TL-2: the moment an ID was made: org-id's `ts` style
 * (`20261029T143012.123456`, local time) or microseconds since the epoch as
 * 16 digits; null for anything else (a UUID).
 */
export function idTime(id: string): Date | null {
  const ts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?$/.exec(id);
  if (ts) {
    const [, y, mo, d, h, mi, s, frac] = ts;
    const ms = frac ? Math.floor(Number(frac.padEnd(6, "0")) / 1000) : 0;
    return new Date(+y, +mo - 1, +d, +h, +mi, +s, ms);
  }
  if (/^\d{16}$/.test(id)) return new Date(Math.floor(Number(id) / 1000));
  return null;
}

/** TL-2: a journal day's file-level ID, another note's, or a heading's */
export type TimelineKind = "journal" | "note" | "heading";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  path: string;
  /** 0-based line of the heading, or 0 for a file-level ID */
  line: number;
  title: string;
  /** the note's title, for a heading */
  note?: string;
  time: Date;
  /** TL-3: vault paths of the media files first linked from here */
  attachments: string[];
}

export interface TimelineDay {
  date: Date;
  entries: TimelineEntry[];
}

export interface Timeline {
  days: TimelineDay[];
  /** TL-3: media files no entry links to, newest name first */
  unlinked: string[];
}

/** a node of one note: its entry, and the lines its subtree covers */
interface Span {
  entry: TimelineEntry;
  from: number;
  to: number;
  level: number;
}

function spans(note: NoteRecord, time: (id: string) => Date, journal: boolean): Span[] {
  const lines = note.text.split("\n");
  const kinds = analyze(lines).lines;
  const lineAt = (offset: number) => note.text.slice(0, offset).split("\n").length - 1;
  const headingLines = kinds.map((l, n) => (l.kind === "heading" ? n : -1)).filter((n) => n >= 0);
  const levelOf = (n: number) => /^\*+/.exec(lines[n])![0].length;
  const seen = new Set<string>();
  const result: Span[] = [];
  for (const { id, offset, heading } of note.ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry: TimelineEntry = heading === undefined
      ? { id, kind: journal ? "journal" : "note", path: note.path, line: 0, title: note.title, time: time(id), attachments: [] }
      : { id, kind: "heading", path: note.path, line: lineAt(offset), title: heading, note: note.title, time: time(id), attachments: [] };
    if (heading === undefined) {
      result.push({ entry, from: 0, to: lines.length, level: 0 });
      continue;
    }
    const level = levelOf(entry.line);
    const next = headingLines.find((n) => n > entry.line && levelOf(n) <= level);
    result.push({ entry, from: entry.line, to: next ?? lines.length, level });
  }
  return result;
}

/** TL-3: the entry a link on `line` belongs to: the deepest node whose subtree holds it. */
function sourceOf(nodes: Span[], line: number): TimelineEntry | null {
  let best: Span | null = null;
  for (const s of nodes) if (line >= s.from && line < s.to && (!best || s.level > best.level)) best = s;
  return best?.entry ?? null;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * TL-2, TL-3: the timeline of `notes`. `files` are the vault's paths (the
 * media among them are the attachments); `created` gives a file's creation
 * time, for IDs that carry none; `journal` holds the journal days' paths (JRN-3).
 */
export function buildTimeline(notes: Iterable<NoteRecord>, files: string[], created: (path: string) => Date, journal: ReadonlySet<string> = new Set()): Timeline {
  const entries: TimelineEntry[] = [];
  const first = new Map<string, TimelineEntry>();
  const taken = new Set<string>();
  for (const note of notes) {
    const nodes = spans(note, (id) => idTime(id) ?? created(note.path), journal.has(note.path)).filter((s) => !taken.has(s.entry.id));
    for (const s of nodes) {
      taken.add(s.entry.id);
      entries.push(s.entry);
    }
    for (const link of note.fileLinks) {
      if (!isMediaFile(link.target)) continue;
      const source = sourceOf(nodes, link.line);
      if (!source) continue;
      const had = first.get(link.target);
      if (!had || source.time < had.time) first.set(link.target, source);
    }
  }
  for (const [path, entry] of first) entry.attachments.push(path);
  for (const e of entries) e.attachments.sort();
  entries.sort((a, b) => b.time.getTime() - a.time.getTime() || a.title.localeCompare(b.title));
  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && dayKey(last.date) === dayKey(entry.time)) last.entries.push(entry);
    else days.push({ date: new Date(entry.time.getFullYear(), entry.time.getMonth(), entry.time.getDate()), entries: [entry] });
  }
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const unlinked = files.filter((p) => isMediaFile(p) && !first.has(p)).sort((a, b) => name(b).localeCompare(name(a)) || a.localeCompare(b));
  return { days, unlinked };
}
