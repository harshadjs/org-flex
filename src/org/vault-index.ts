// The vault index (§5a): for every .org file, its IDs, title and note links.
// It answers "where is ID X" and "who links to this note" without reading
// files, and finds unlinked mentions in the text it keeps.

import { analyze, AUDIO_EXTENSIONS, findLinks, IMAGE_EXTENSIONS, Keywords, parseHeading, parseProperty, relativeLinkPath, resolveRelative } from "./syntax";
import { denoteIdOf } from "./denote";

/** DEN-1: how notes are linked: by `:ID:` (org-roam) or by the identifier in Denote file names. */
export type LinkScheme = "id" | "denote";

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
  /** DEN-2: the identifier in the file name, for a Denote file */
  denoteId: string | null;
  /** DEN-7: headings with a `CUSTOM_ID`, which Denote links to as `denote:ID::#custom-id` */
  customIds: NoteId[];
  links: NoteLink[];
  /** BL-7: `[[file:…]]` links, the target as a vault path */
  fileLinks: NoteLink[];
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
  else if (/^denote:/i.test(t)) t = t.slice(7).trim();
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
  const customIds: NoteId[] = [];
  const links: NoteLink[] = [];
  const fileLinks: NoteLink[] = [];
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
      const key = prop?.key.toUpperCase();
      if (prop && (key === "ID" || key === "CUSTOM_ID") && prop.value.trim() && structure.drawers[structure.lines[n].drawer].name === "PROPERTIES") {
        const found = heading === undefined ? { id: prop.value.trim(), offset: entry } : { id: prop.value.trim(), offset: entry, heading };
        if (key === "ID") ids.push(found);
        else if (heading !== undefined) customIds.push(found);
      }
    } else if (kind === "keyword" && !seenHeading && title === null) {
      const m = /^[ \t]*#\+title:[ \t]*(.*?)[ \t]*$/i.exec(line);
      if (m && m[1]) title = m[1];
    }
    if (line.includes("[[")) {
      for (const link of findLinks(line)) {
        if (link.style !== "regular") continue;
        if (/^file:/i.test(link.target.trim())) {
          const file = resolveRelative(path, link.target);
          if (file) fileLinks.push({ target: file, line: n });
          continue;
        }
        const target = noteLinkTarget(link.target);
        if (target) links.push({ target, line: n });
      }
    }
    offset += line.length + 1;
  }
  const name = fileName(path);
  return { path, name, title: title ?? name, ids, denoteId: denoteIdOf(path), customIds, links, fileLinks, text };
}

function lineOf(text: string, n: number): string {
  return text.split("\n", n + 1)[n] ?? "";
}

function byTitle(a: { title: string; path: string }, b: { title: string; path: string }): number {
  return a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
}

/** BL-1: other files linking to `note` by file name or by any of its IDs. */
export function backlinksTo(note: NoteRecord, notes: Iterable<NoteRecord>): Backlink[] {
  const names = new Set([note.name, ...note.ids.map((i) => i.id), ...(note.denoteId ? [note.denoteId] : [])]);
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

/** BL-7: the files whose backlinks show in their own view: images, audio, video and PDFs. */
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, "mp4", "m4v", "mov", "mkv", "pdf"]);

export function isMediaFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 && MEDIA_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/** BL-7: the notes with a `[[file:…]]` link to the file at `path`, as BL-1 lists them. */
export function fileBacklinksTo(path: string, notes: Iterable<NoteRecord>): Backlink[] {
  const result: Backlink[] = [];
  for (const other of notes) {
    const lines = Array.from(new Set(other.fileLinks.filter((l) => l.target === path).map((l) => l.line)));
    if (!lines.length) continue;
    result.push({
      path: other.path,
      title: other.title,
      lines: lines.map((line) => ({ line, text: lineOf(other.text, line).trim() })),
    });
  }
  return result.sort(byTitle);
}

/**
 * LP-9: a file that isn't a note (an image, a recording, a PDF...) in the
 * `[[` list: marked 📎, its folder beside it, and linked as `file:` with the
 * path relative to the note, as attachments are (ATT-3).
 */
export function attachmentCompletion(notePath: string, path: string): { label: string; displayLabel: string; detail?: string; target: string; type: string } {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  return {
    label: name,
    displayLabel: `📎 ${name}`,
    ...(slash > 0 ? { detail: path.slice(0, slash) } : {}),
    target: `file:${relativeLinkPath(notePath, path)}`,
    type: "attachment",
  };
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

/** BL-3, CAP-9, DEN-1: the link target naming the whole note in `scheme`, or null when it has none. */
export function noteTarget(note: NoteRecord, scheme: LinkScheme): string | null {
  if (scheme === "denote") return note.denoteId !== null ? `denote:${note.denoteId}` : null;
  const fileId = note.ids.find((i) => i.offset === 0 && i.heading === undefined)?.id;
  return fileId !== undefined ? `id:${fileId}` : null;
}

/**
 * BL-3: the link that replaces a mention: [[id:ID][words]] with the note's
 * file-level ID ([[denote:ID][words]] with Denote); a note without one is
 * linked by file name.
 */
export function mentionLink(note: NoteRecord, words: string, scheme: LinkScheme = "id"): string {
  const target = noteTarget(note, scheme);
  if (target !== null) return `[[${target}][${linkDescription(words)}]]`;
  return words === note.name ? `[[${note.name}]]` : `[[${note.name}][${linkDescription(words)}]]`;
}

export interface TitleCompletion {
  /** what the list shows and matches: the note's or heading's title */
  label: string;
  /** the folder for a note, the note's title for a heading */
  detail?: string;
  id: string;
  /** the link target: `id:ID`, `denote:ID` or `denote:ID::#custom-id` */
  target: string;
}

/**
 * LP-9: every ID in the vault, by title, notes before their headings. With
 * Denote (DEN-7), every Denote org note and its headings with a `CUSTOM_ID`.
 */
export function titleCompletions(notes: Iterable<NoteRecord>, scheme: LinkScheme = "id"): TitleCompletion[] {
  const result: TitleCompletion[] = [];
  for (const note of Array.from(notes).sort(byTitle)) {
    const slash = note.path.lastIndexOf("/");
    const folder = slash > 0 ? note.path.slice(0, slash) : undefined;
    if (scheme === "denote") {
      const fileId = note.denoteId;
      if (fileId === null) continue;
      result.push({ label: note.title, detail: folder, id: fileId, target: `denote:${fileId}` });
      for (const { id, heading } of note.customIds) {
        result.push({ label: heading || note.title, detail: note.title, id: `${fileId}::#${id}`, target: `denote:${fileId}::#${id}` });
      }
      continue;
    }
    for (const { id, heading } of note.ids) {
      if (heading === undefined) result.push({ label: note.title, detail: folder, id, target: `id:${id}` });
      else result.push({ label: heading || note.title, detail: note.title, id, target: `id:${id}` });
    }
  }
  return result;
}

/**
 * DEN-1: where in `note` a link's `::search` part points: `#custom-id` is the
 * heading with that `CUSTOM_ID`, `*Heading` the first heading with that title
 * (keyword, priority and tags left out); null when nothing matches or there's no search.
 */
export function searchOffset(note: NoteRecord, search: string, keywords: Keywords = DEFAULT_KEYWORDS): number | null {
  const s = search.trim();
  if (s.startsWith("#")) return note.customIds.find((c) => c.id === s.slice(1))?.offset ?? null;
  if (!s.startsWith("*")) return null;
  const want = s.slice(1).trim();
  let offset = 0;
  for (const line of note.text.split("\n")) {
    if (/^\*+[ \t]/.test(line) && headingTitle(line, keywords) === want) return offset;
    offset += line.length + 1;
  }
  return null;
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

  titles(scheme: LinkScheme = "id"): TitleCompletion[] {
    return titleCompletions(this.notes.values(), scheme);
  }

  backlinks(path: string): Backlink[] {
    const note = this.notes.get(path);
    return note ? backlinksTo(note, this.notes.values()) : [];
  }

  fileBacklinks(path: string): Backlink[] {
    return fileBacklinksTo(path, this.notes.values());
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
