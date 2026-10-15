// Front matter (§7): an optional property drawer on line 1 followed by
// #+KEY: value lines. Pure parsing and value formatting; the panel itself is
// in editor/front-matter-panel.ts.

export interface FrontMatterEntry {
  key: string;
  value: string;
  /** 0-based line */
  line: number;
  source: "drawer" | "keyword";
}

export interface FrontMatter {
  /** 0-based line of the drawer's :PROPERTIES:, or null without a drawer */
  drawerLine: number | null;
  /** 0-based last line of the front matter */
  endLine: number;
  title: FrontMatterEntry | null;
  /** everything except #+title, in file order */
  entries: FrontMatterEntry[];
}

const KEYWORD_RE = /^#\+([^\s:]+):[ \t]*(.*?)[ \t]*$/;
const PROPERTY_RE = /^[ \t]*:([^:\s]+):(?:[ \t]+(.*?))?[ \t]*$/;
// keywords that belong to the element after them
const AFFILIATED = /^(?:name|caption|results|header|plot|tblfm|attr_.*)$/i;

/** FM-1. Null when the file has no front matter. */
export function parseFrontMatter(lines: string[]): FrontMatter | null {
  const entries: FrontMatterEntry[] = [];
  let title: FrontMatterEntry | null = null;
  let n = 0;
  let drawerLine: number | null = null;
  if (lines.length && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[0])) {
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (/^[ \t]*:END:[ \t]*$/i.test(lines[i])) {
        end = i;
        break;
      }
      if (/^\*+(?:[ \t]|$)/.test(lines[i])) break;
    }
    if (end < 0) return null;
    drawerLine = 0;
    for (let i = 1; i < end; i++) {
      const m = PROPERTY_RE.exec(lines[i]);
      if (m) entries.push({ key: m[1], value: m[2] ?? "", line: i, source: "drawer" });
    }
    n = end + 1;
  }
  for (; n < lines.length; n++) {
    const m = KEYWORD_RE.exec(lines[n]);
    if (!m || AFFILIATED.test(m[1]) || /^begin_/i.test(m[1])) break;
    const entry: FrontMatterEntry = { key: m[1], value: m[2], line: n, source: "keyword" };
    if (m[1].toLowerCase() === "title" && !title) title = entry;
    else entries.push(entry);
  }
  if (n === 0) return null;
  return { drawerLine, endLine: n - 1, title, entries };
}

export type ValueDisplay =
  | { kind: "pills"; items: string[] }
  | { kind: "text"; text: string }
  | { kind: "empty" };

const DATE_RE = /^[<\[](\d{4}-\d{2}-\d{2}[^>\]]*)[>\]]$/;

/** Links show their description (or target), timestamps lose their brackets. */
export function simplifyValue(value: string): string {
  return value
    .replace(/\[\[([^\[\]]+)\](?:\[([^\[\]]*)\])?\]/g, (_m, target: string, desc?: string) => desc || target)
    .replace(/[<\[](\d{4}-\d{2}-\d{2}[^>\]\n]*)[>\]]/g, "$1");
}

function splitAliases(value: string): string[] {
  const items: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const item = m[1] ?? m[2];
    if (item) items.push(item);
  }
  return items;
}

/** FM-3: how a value is shown. */
export function displayValue(key: string, value: string): ValueDisplay {
  const v = value.trim();
  if (!v) return { kind: "empty" };
  const k = key.toLowerCase();
  if (k === "filetags" || k === "tags") {
    return { kind: "pills", items: v.split(/[:\s]+/).filter(Boolean) };
  }
  if (k.endsWith("aliases")) return { kind: "pills", items: splitAliases(v) };
  return { kind: "text", text: simplifyValue(v) };
}

/** FM-3: the Lucide icon for a property row. */
export function propertyIcon(key: string, value: string): string {
  const k = key.toLowerCase();
  if (k === "id" || k === "custom_id") return "fingerprint";
  if (k === "filetags" || k === "tags") return "tags";
  if (k.endsWith("aliases")) return "forward";
  if (DATE_RE.test(value.trim()) || k === "date" || k.endsWith("_date") || k === "created" || k === "modified") return "calendar";
  if (/\[\[[^\]]+\]/.test(value)) return "link";
  return "text";
}
