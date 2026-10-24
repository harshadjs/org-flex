// Org syntax, line by line. Everything here is pure: it works on plain
// strings so it can be tested without an editor.
//
// The document is classified one line at a time (headings, planning lines,
// drawers, blocks, keywords, comments, text). Inline syntax (markup and
// links) is parsed per line on demand.

export interface Keywords {
  todo: string[];
  done: string[];
}

export const NO_KEYWORDS: Keywords = { todo: [], done: [] };

// ---------------------------------------------------------------------------
// Headings

/** A heading: one or more `*` at column 0, then whitespace or the end of the line. */
const HEADING_RE = /^(\*+)(?:[ \t]+|$)/;

export function headingLevel(text: string): number {
  const m = HEADING_RE.exec(text);
  return m ? m[1].length : 0;
}

export interface Span {
  from: number;
  to: number;
}

export interface HeadingParts {
  level: number;
  /** the stars and the whitespace after them */
  stars: Span;
  keyword: (Span & { text: string; done: boolean }) | null;
  priority: (Span & { value: string }) | null;
  /** the title text, without keyword, priority and tags */
  title: Span;
  tags: (Span & { tags: string[] }) | null;
}

/** The parts of a heading line, with offsets inside the line; null if it isn't a heading. */
export function parseHeading(text: string, keywords: Keywords): HeadingParts | null {
  const m = HEADING_RE.exec(text);
  if (!m) return null;
  const level = m[1].length;
  let pos = m[0].length;
  let end = text.length;
  // trailing whitespace isn't title
  while (end > pos && /[ \t]/.test(text[end - 1])) end--;

  let tags: HeadingParts["tags"] = null;
  const tagMatch = /(?:^|[ \t])(:(?:[\p{L}\p{N}_@#%]+:)+)$/u.exec(text.slice(pos, end));
  if (tagMatch) {
    const tagFrom = pos + tagMatch.index + tagMatch[0].length - tagMatch[1].length;
    tags = { from: tagFrom, to: end, tags: tagMatch[1].split(":").filter(Boolean) };
    end = tagFrom;
    while (end > pos && /[ \t]/.test(text[end - 1])) end--;
  }

  let keyword: HeadingParts["keyword"] = null;
  const word = /^\S+/.exec(text.slice(pos, end));
  if (word) {
    const w = word[0];
    const isTodo = keywords.todo.includes(w);
    const isDone = keywords.done.includes(w);
    const after = text[pos + w.length];
    if ((isTodo || isDone) && (after === undefined || after === " " || after === "\t" || pos + w.length === end)) {
      keyword = { from: pos, to: pos + w.length, text: w, done: isDone && !isTodo };
      pos += w.length;
      while (pos < end && /[ \t]/.test(text[pos])) pos++;
    }
  }

  let priority: HeadingParts["priority"] = null;
  const prio = /^\[#([A-Za-z0-9])\](?=[ \t]|$)/.exec(text.slice(pos, end));
  if (prio) {
    priority = { from: pos, to: pos + prio[0].length, value: prio[1] };
    pos += prio[0].length;
    while (pos < end && /[ \t]/.test(text[pos])) pos++;
  }

  return {
    level,
    stars: { from: 0, to: m[0].length },
    keyword,
    priority,
    title: { from: pos, to: Math.max(pos, end) },
    tags,
  };
}

// ---------------------------------------------------------------------------
// Line classification

export type LineKind =
  | "heading"
  | "planning"
  | "drawer-begin"
  | "drawer-end"
  | "property"
  | "drawer-content"
  | "block-begin"
  | "block-end"
  | "block-content"
  | "keyword"
  | "comment"
  | "text"
  | "blank";

export interface LineInfo {
  kind: LineKind;
  /** heading level for headings */
  level: number;
  /** index into OrgStructure.blocks for block lines */
  block: number;
  /** index into OrgStructure.drawers for drawer lines */
  drawer: number;
}

export interface BlockInfo {
  /** 0-based line numbers of the #+begin and #+end lines */
  begin: number;
  end: number;
  /** "src", "quote", "example", ... in lower case */
  name: string;
  /** first parameter: the language of a src block, lower case */
  language: string;
}

export interface DrawerInfo {
  begin: number;
  end: number;
  name: string;
}

export interface OrgStructure {
  lines: LineInfo[];
  blocks: BlockInfo[];
  drawers: DrawerInfo[];
  /** 0-based line numbers of headings, in order */
  headings: number[];
}

const BLOCK_BEGIN_RE = /^[ \t]*#\+begin_(\S+)(?:[ \t]+(\S+))?/i;
const DRAWER_BEGIN_RE = /^[ \t]*:([\w-]+):[ \t]*$/;
const DRAWER_END_RE = /^[ \t]*:end:[ \t]*$/i;
const PROPERTY_RE = /^[ \t]*:([^:\s]+):(?:[ \t]+(.*?))?[ \t]*$/;
const PLANNING_RE = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const KEYWORD_RE = /^[ \t]*#\+[^\s:]+:/;
const COMMENT_RE = /^[ \t]*#(?:[ \t]|$)/;

export function isPlanningLine(text: string): boolean {
  return PLANNING_RE.test(text);
}

function blockEndRe(name: string): RegExp {
  return new RegExp(`^[ \\t]*#\\+end_${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "i");
}

/**
 * Classify every line. A block or drawer only counts when it's closed before
 * the next heading (headings always win, as in Org); otherwise its first line
 * is plain text.
 */
export function analyze(lines: string[]): OrgStructure {
  const info: LineInfo[] = new Array(lines.length);
  const blocks: BlockInfo[] = [];
  const drawers: DrawerInfo[] = [];
  const headings: number[] = [];

  const plain = (kind: LineKind): LineInfo => ({ kind, level: 0, block: -1, drawer: -1 });

  let n = 0;
  while (n < lines.length) {
    const text = lines[n];
    const level = headingLevel(text);
    if (level) {
      info[n] = { kind: "heading", level, block: -1, drawer: -1 };
      headings.push(n);
      n++;
      if (n < lines.length && PLANNING_RE.test(lines[n])) {
        info[n] = plain("planning");
        n++;
      }
      continue;
    }

    const begin = BLOCK_BEGIN_RE.exec(text);
    if (begin) {
      const end = findClose(lines, n, blockEndRe(begin[1]));
      if (end >= 0) {
        const index = blocks.length;
        blocks.push({ begin: n, end, name: begin[1].toLowerCase(), language: (begin[2] ?? "").toLowerCase() });
        info[n] = { kind: "block-begin", level: 0, block: index, drawer: -1 };
        for (let i = n + 1; i < end; i++) info[i] = { kind: "block-content", level: 0, block: index, drawer: -1 };
        info[end] = { kind: "block-end", level: 0, block: index, drawer: -1 };
        n = end + 1;
        continue;
      }
    }

    const drawer = DRAWER_BEGIN_RE.exec(text);
    if (drawer && drawer[1].toLowerCase() !== "end") {
      const end = findClose(lines, n, DRAWER_END_RE);
      if (end >= 0) {
        const index = drawers.length;
        const name = drawer[1].toUpperCase();
        drawers.push({ begin: n, end, name });
        info[n] = { kind: "drawer-begin", level: 0, block: -1, drawer: index };
        for (let i = n + 1; i < end; i++) {
          const kind: LineKind = name === "PROPERTIES" && PROPERTY_RE.test(lines[i]) ? "property" : "drawer-content";
          info[i] = { kind, level: 0, block: -1, drawer: index };
        }
        info[end] = { kind: "drawer-end", level: 0, block: -1, drawer: index };
        n = end + 1;
        continue;
      }
    }

    if (!text.trim()) info[n] = plain("blank");
    else if (KEYWORD_RE.test(text)) info[n] = plain("keyword");
    else if (COMMENT_RE.test(text)) info[n] = plain("comment");
    else info[n] = plain("text");
    n++;
  }
  return { lines: info, blocks, drawers, headings };
}

function findClose(lines: string[], begin: number, close: RegExp): number {
  for (let i = begin + 1; i < lines.length; i++) {
    if (headingLevel(lines[i])) return -1;
    if (close.test(lines[i])) return i;
  }
  return -1;
}

/** `:KEY: value` inside a property drawer; null for other lines. */
export function parseProperty(text: string): { key: string; value: string } | null {
  const m = PROPERTY_RE.exec(text);
  if (!m || m[1].toLowerCase() === "end") return null;
  return { key: m[1], value: m[2] ?? "" };
}

// ---------------------------------------------------------------------------
// Inline syntax: links and markup

export type MarkupType = "bold" | "italic" | "underline" | "verbatim" | "code" | "strikethrough";

export const MARKERS: Record<string, MarkupType> = {
  "*": "bold",
  "/": "italic",
  "_": "underline",
  "=": "verbatim",
  "~": "code",
  "+": "strikethrough",
};

export interface LinkNode {
  type: "link";
  /** "regular" is [[...]], "angle" is <scheme:...>, "plain" is a bare URL */
  style: "regular" | "angle" | "plain";
  from: number;
  to: number;
  target: string;
  /** offsets of the target text */
  targetFrom: number;
  targetTo: number;
  /** the description of [[target][description]], else null */
  description: string | null;
  descFrom: number;
  descTo: number;
}

export interface MarkupNode {
  type: MarkupType;
  from: number;
  to: number;
  children: InlineNode[];
}

export type InlineNode = LinkNode | MarkupNode;

const REGULAR_LINK_RE = /\[\[((?:[^\[\]\\]|\\.)+)\](?:\[([^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*)\])?\]/g;
const SCHEMES = "https?|ftp|mailto|file|news|doi|shell|elisp|attachment|id";
const ANGLE_LINK_RE = new RegExp(`<((?:${SCHEMES}):[^<>\\n]+)>`, "gi");
const PLAIN_LINK_RE = /\b(?:https?|ftp|mailto):[^\s<>\[\]()"']+/gi;

/** Every link on a line, in order, without overlaps. */
export function findLinks(text: string): LinkNode[] {
  const links: LinkNode[] = [];
  const taken = (from: number, to: number) => links.some((l) => from < l.to && to > l.from);
  if (text.includes("[[")) {
    REGULAR_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REGULAR_LINK_RE.exec(text))) {
      const from = m.index;
      const targetFrom = from + 2;
      const targetTo = targetFrom + m[1].length;
      const hasDesc = m[2] !== undefined;
      links.push({
        type: "link",
        style: "regular",
        from,
        to: from + m[0].length,
        target: m[1],
        targetFrom,
        targetTo,
        description: hasDesc ? m[2] : null,
        descFrom: hasDesc ? targetTo + 2 : targetFrom,
        descTo: hasDesc ? targetTo + 2 + m[2].length : targetTo,
      });
    }
  }
  if (text.includes("<")) {
    ANGLE_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ANGLE_LINK_RE.exec(text))) {
      const from = m.index;
      const to = from + m[0].length;
      if (taken(from, to)) continue;
      links.push({
        type: "link", style: "angle", from, to, target: m[1],
        targetFrom: from + 1, targetTo: to - 1, description: null, descFrom: from + 1, descTo: to - 1,
      });
    }
  }
  if (text.includes(":")) {
    PLAIN_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLAIN_LINK_RE.exec(text))) {
      const from = m.index;
      // trailing punctuation belongs to the sentence
      const url = m[0].replace(/[.,;:!?]+$/, "");
      const to = from + url.length;
      if (taken(from, to)) continue;
      links.push({
        type: "link", style: "plain", from, to, target: url,
        targetFrom: from, targetTo: to, description: null, descFrom: from, descTo: to,
      });
    }
  }
  return links.sort((a, b) => a.from - b.from);
}

const PRE = /[\s\-({'"]/;
const POST = /[\s\-.,;:!?')}"\\\[]/;

/**
 * Links and markup on one line, as a tree. Markup is matched left to right:
 * an opening marker pairs with the nearest valid closing one, and whatever is
 * inside is parsed again. So overlapping markup becomes a tree instead of
 * crossing: in `*one _two three* four_` only `*one _two three*` is bold.
 * Links are atomic: markup never ends inside one.
 */
export function parseInline(text: string, from = 0, to = text.length): InlineNode[] {
  const links = findLinks(text).filter((l) => l.from >= from && l.to <= to);
  return parseRange(text, from, to, links);
}

function parseRange(text: string, from: number, to: number, links: LinkNode[]): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = from;
  while (i < to) {
    const link = links.find((l) => l.from === i);
    if (link) {
      nodes.push(link);
      i = link.to;
      continue;
    }
    const type = MARKERS[text[i]];
    // the edges of the enclosing markup count as borders, so markup can nest
    if (type && (i === from || PRE.test(text[i - 1])) && i + 1 < to && !/\s/.test(text[i + 1])) {
      const close = findCloser(text, i, to, links);
      if (close > 0) {
        const children = type === "verbatim" || type === "code"
          ? []
          : parseRange(text, i + 1, close, links.filter((l) => l.from > i && l.to <= close));
        nodes.push({ type, from: i, to: close + 1, children });
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return nodes;
}

function findCloser(text: string, open: number, to: number, links: LinkNode[]): number {
  const marker = text[open];
  for (let j = open + 2; j < to; j++) {
    const link = links.find((l) => l.from <= j && j < l.to);
    if (link) {
      j = link.to - 1;
      continue;
    }
    if (text[j] !== marker || /\s/.test(text[j - 1])) continue;
    if (j + 1 === to || j + 1 === text.length || POST.test(text[j + 1])) return j;
  }
  return -1;
}

/** Every node of an inline tree, depth first. */
export function* walkInline(nodes: InlineNode[]): Generator<InlineNode> {
  for (const node of nodes) {
    yield node;
    if (node.type !== "link") yield* walkInline(node.children);
  }
}

// ---------------------------------------------------------------------------
// Link targets

export const IMAGE_EXTENSIONS = ["apng", "avif", "gif", "jpeg", "jpg", "png", "svg", "webp"];
export const AUDIO_EXTENSIONS = ["3gp", "aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "webm"];

function extension(target: string): string {
  const clean = target.replace(/^file:/, "").split(/[?#]/)[0].split("::")[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

export function isImageTarget(target: string): boolean {
  return IMAGE_EXTENSIONS.includes(extension(target));
}

/** LP-11: a link target that plays as audio. */
export function isAudioTarget(target: string): boolean {
  return AUDIO_EXTENSIONS.includes(extension(target));
}

export type LinkKind = { kind: "external"; url: string } | { kind: "id"; id: string } | { kind: "file"; path: string };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** How a link target opens (LINK-1). */
export function classifyLink(target: string): LinkKind {
  const t = target.trim();
  if (/^id:/i.test(t)) return { kind: "id", id: t.slice(3).trim() };
  // a relative file: link is a file in the vault, as Org reads it
  if (/^file:(?!\/)/i.test(t)) return { kind: "file", path: t.slice(5) };
  if (SCHEME_RE.test(t)) return { kind: "external", url: t };
  return { kind: "file", path: t };
}

/**
 * LINK-2: the vault path a relative link names from the note at `notePath`:
 * `file:` and `::search` dropped, `.` and `..` worked out from the note's
 * folder. Null when it climbs above the vault or is absolute.
 */
export function resolveRelative(notePath: string, target: string): string | null {
  const t = target.trim().replace(/^file:/i, "").split("::")[0];
  if (!t || t.startsWith("/")) return null;
  const parts = notePath.split("/").slice(0, -1);
  for (const part of t.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** ATT-3: the path of `filePath` as seen from the folder of the note at `notePath`, for a `file:` link. */
export function relativeLinkPath(notePath: string, filePath: string): string {
  const from = notePath.split("/").slice(0, -1);
  const to = filePath.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}
