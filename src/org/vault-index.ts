// The vault index (§5a): for every .org file, its IDs, title and note links.
// It answers "where is ID X" and "who links to this note" without reading
// files, and finds unlinked mentions in the text it keeps.

import { analyze, findLinks, Keywords, parseHeading, parseProperty } from "./syntax";

export interface NoteId {
  id: string;
  /** offset of the entry: 0 for a file-level drawer, else its heading's start */
  offset: number;
  /** the heading's title (links shown as their description); absent for a file-level ID */
  heading?: string;
}

const DEFAULT_KEYWORDS: Keywords = { todo: ["TODO"], done: ["DONE"] };

/** A heading's title as a reader sees it: no keyword, priority or tags, links as their text. */
export function headingTitle(line: string, keywords: Keywords): string {
  const parts = parseHeading(line, keywords);
  if (!parts) return line.trim();
  return line.slice(parts.title.from, parts.title.to)
    .replace(/\[\[([^\]]*)\](?:\[([^\]]*)\])?\]/g, (_, target: string, desc?: string) => desc ?? target)
    .trim();
}

export interface NoteLink {
  /** IDX-2: the target without `id:`, `.org` and `::search` */
  target: string;
  /** 0-based line */
  line: number;
}

export interface NoteRecord {
  path: string;
  /** file name without extension */
  name: string;
  title: string;
  ids: NoteId[];
  links: NoteLink[];
  text: string;
}

export interface Backlink {
  path: string;
  title: string;
  lines: { line: number; text: string }[];
}

export interface Mention {
  path: string;
  title: string;
  line: number;
  text: string;
  /** offsets of the mentioned words in that file */
  from: number;
  to: number;
  words: string;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** IDX-2: the note a link target points to, or null for URLs, files and in-file targets. */
export function noteLinkTarget(raw: string): string | null {
  let t = raw.trim();
  if (/^id:/i.test(t)) t = t.slice(3).trim();
  else if (SCHEME_RE.test(t) || t.startsWith("*") || t.startsWith("#")) return null;
  const search = t.indexOf("::");
  if (search >= 0) t = t.slice(0, search);
  if (t.toLowerCase().endsWith(".org")) t = t.slice(0, -4);
  return t || null;
}

export function fileName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** IDX-1: what the index keeps about one file. */
export function readNote(path: string, text: string, keywords: Keywords = DEFAULT_KEYWORDS): NoteRecord {
  const lines = text.split("\n");
  const structure = analyze(lines);
  const ids: NoteId[] = [];
  const links: NoteLink[] = [];
  let title: string | null = null;
  let entry = 0;
  let heading: string | undefined;
  let offset = 0;
  let seenHeading = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const kind = structure.lines[n].kind;
    if (kind === "heading") {
      entry = offset;
      heading = headingTitle(line, keywords);
      seenHeading = true;
    } else if (kind === "property") {
      const prop = parseProperty(line);
      if (prop && prop.key.toUpperCase() === "ID" && prop.value.trim() && structure.drawers[structure.lines[n].drawer].name === "PROPERTIES") {
        ids.push(heading === undefined ? { id: prop.value.trim(), offset: entry } : { id: prop.value.trim(), offset: entry, heading });
      }
    } else if (kind === "keyword" && !seenHeading && title === null) {
      const m = /^[ \t]*#\+title:[ \t]*(.*?)[ \t]*$/i.exec(line);
      if (m && m[1]) title = m[1];
    }
    if (line.includes("[[")) {
      for (const link of findLinks(line)) {
        if (link.style !== "regular") continue;
        const target = noteLinkTarget(link.target);
        if (target) links.push({ target, line: n });
      }
    }
    offset += line.length + 1;
  }
  const name = fileName(path);
  return { path, name, title: title ?? name, ids, links, text };
}

function lineOf(text: string, n: number): string {
  return text.split("\n", n + 1)[n] ?? "";
}

function byTitle(a: { title: string; path: string }, b: { title: string; path: string }): number {
  return a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
}

/** BL-1: other files linking to `note` by file name or by any of its IDs. */
export function backlinksTo(note: NoteRecord, notes: Iterable<NoteRecord>): Backlink[] {
  const names = new Set([note.name, ...note.ids.map((i) => i.id)]);
  const result: Backlink[] = [];
  for (const other of notes) {
    if (other.path === note.path) continue;
    const lines = Array.from(new Set(other.links.filter((l) => names.has(l.target)).map((l) => l.line)));
    if (!lines.length) continue;
    result.push({
      path: other.path,
      title: other.title,
      lines: lines.map((line) => ({ line, text: lineOf(other.text, line).trim() })),
    });
  }
  return result.sort(byTitle);
}

/** BL-2: the words a mention may use. */
export function mentionNames(note: NoteRecord): string[] {
  const names = new Set<string>();
  for (const name of [note.title, note.name]) {
    names.add(name);
    names.add(name.replace(/-/g, " "));
  }
  return Array.from(names).filter((n) => n.trim().length >= 3).sort((a, b) => b.length - a.length);
}

const NOT_PROSE = /^[ \t]*(?:#\+|:[\w-]+:)/;

/** BL-2: places in other files naming `note` without linking to it. */
export function unlinkedMentionsOf(note: NoteRecord, notes: Iterable<NoteRecord>, limit = 50): Mention[] {
  const names = mentionNames(note);
  if (!names.length) return [];
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_-])`, "giu");
  const result: Mention[] = [];
  const others = Array.from(notes).filter((n) => n.path !== note.path).sort(byTitle);
  for (const other of others) {
    let offset = 0;
    const lines = other.text.split("\n");
    for (let n = 0; n < lines.length; offset += lines[n].length + 1, n++) {
      const line = lines[n];
      if (NOT_PROSE.test(line)) continue;
      const links = findLinks(line).filter((l) => l.style === "regular");
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const from = m.index;
        const to = from + m[0].length;
        if (links.some((l) => from < l.to && to > l.from)) continue;
        result.push({ path: other.path, title: other.title, line: n, text: line.trim(), from: offset + from, to: offset + to, words: m[0] });
        if (result.length >= limit) return result;
      }
    }
  }
  return result;
}

/** LP-9: a description can't hold brackets, or the link would end early. */
export function linkDescription(text: string): string {
  return text.replace(/[\[\]]/g, "").trim();
}

/**
 * BL-3: the link that replaces a mention: [[id:ID][words]] with the note's
 * file-level ID; a note without one is linked by file name.
 */
export function mentionLink(note: NoteRecord, words: string): string {
  const fileId = note.ids.find((i) => i.offset === 0 && i.heading === undefined)?.id;
  if (fileId !== undefined) return `[[id:${fileId}][${linkDescription(words)}]]`;
  return words === note.name ? `[[${note.name}]]` : `[[${note.name}][${linkDescription(words)}]]`;
}

export interface TitleCompletion {
  /** what the list shows and matches: the note's or heading's title */
  label: string;
  /** the folder for a note, the note's title for a heading */
  detail?: string;
  id: string;
}

/** LP-9: every ID in the vault, by title, notes before their headings. */
export function titleCompletions(notes: Iterable<NoteRecord>): TitleCompletion[] {
  const result: TitleCompletion[] = [];
  for (const note of Array.from(notes).sort(byTitle)) {
    const slash = note.path.lastIndexOf("/");
    const folder = slash > 0 ? note.path.slice(0, slash) : undefined;
    for (const { id, heading } of note.ids) {
      if (heading === undefined) result.push({ label: note.title, detail: folder, id });
      else result.push({ label: heading || note.title, detail: note.title, id });
    }
  }
  return result;
}

export interface IndexSource {
  paths(): string[];
  read(path: string): Promise<string>;
  /** the TODO keywords, so heading titles leave them out */
  keywords?(): Keywords;
}

/** IDX-1: keeps a NoteRecord per .org file and tells listeners about changes (batched). */
export class VaultIndex {
  notes = new Map<string, NoteRecord>();
  ready: Promise<void>;
  private markReady!: () => void;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private source: IndexSource, private delay = 300) {
    this.ready = new Promise((resolve) => (this.markReady = resolve));
  }

  async build(): Promise<void> {
    const notes = new Map<string, NoteRecord>();
    for (const path of this.source.paths()) {
      try {
        notes.set(path, readNote(path, await this.source.read(path), this.source.keywords?.()));
      } catch {
        // unreadable: left out
      }
    }
    this.notes = notes;
    this.markReady();
    this.changed();
  }

  async update(path: string): Promise<void> {
    await this.ready;
    try {
      this.notes.set(path, readNote(path, await this.source.read(path), this.source.keywords?.()));
    } catch {
      this.notes.delete(path);
    }
    this.changed();
  }

  remove(path: string) {
    if (this.notes.delete(path)) this.changed();
  }

  async rename(from: string, to: string) {
    this.notes.delete(from);
    await this.update(to);
  }

  /** Where `id` is defined; the first file found wins. */
  findId(id: string): { path: string; offset: number } | null {
    for (const note of this.notes.values()) {
      const hit = note.ids.find((i) => i.id === id);
      if (hit) return { path: note.path, offset: hit.offset };
    }
    return null;
  }

  ids(): { id: string; path: string }[] {
    const all: { id: string; path: string }[] = [];
    for (const note of this.notes.values()) for (const { id } of note.ids) all.push({ id, path: note.path });
    return all;
  }

  titles(): TitleCompletion[] {
    return titleCompletions(this.notes.values());
  }

  backlinks(path: string): Backlink[] {
    const note = this.notes.get(path);
    return note ? backlinksTo(note, this.notes.values()) : [];
  }

  unlinkedMentions(path: string): Mention[] {
    const note = this.notes.get(path);
    return note ? unlinkedMentionsOf(note, this.notes.values()) : [];
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const listener of this.listeners) listener();
    }, this.delay);
  }
}
