// Denote (§5c): notes and files named `ID--title__keywords.ext`, linked as
// `[[denote:ID]]`. The identifier is in the file name, so any file (an image,
// a recording) can be a link target, and a rename that keeps it keeps links.

/** DEN-2: an identifier is letters and digits (`20261026T210000`, `2610a`, `261003`). */
const ID = "[0-9A-Za-z]+";
const NAME_RE = new RegExp(`^(?:@@)?(${ID})(?=--|__|==|@@|$)`);
const LATER_ID_RE = new RegExp(`@@(${ID})(?=--|__|==|@@|$)`);

/** The file name without folders or extension. */
function stem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * DEN-2: the identifier in a Denote file name, or null when the name isn't
 * one. The identifier comes first, or anywhere after `@@`; a name that is
 * only letters and digits needs another component (`--title`, `__keywords`,
 * `==signature`), so `index.org` or `README.org` aren't taken for Denote files.
 */
export function denoteIdOf(path: string): string | null {
  const name = stem(path);
  const later = LATER_ID_RE.exec(name);
  if (later) return later[1];
  const m = NAME_RE.exec(name);
  if (!m || m[0].length === name.length) return null;
  return m[1];
}

/**
 * DEN-7: how a file with a Denote name reads in a list: its title with the
 * slug's `-` as spaces (`@@2610o--pxl-20261021.webp` → `pxl 20261021`), or
 * its identifier when it has no title. Null when the name isn't Denote's.
 */
export function denoteLabel(path: string): string | null {
  const id = denoteIdOf(path);
  if (id === null) return null;
  const title = /--(.+?)(?=__|==|@@|$)/.exec(stem(path).replace(`@@${id}`, ""));
  return title ? title[1].replace(/-/g, " ") : id;
}

/** DEN-1: the parts of a `denote:` link target, or null for any other link. */
export function parseDenoteLink(target: string): { id: string; search: string } | null {
  const m = /^denote:([^:]+?)(?:::(.*))?$/i.exec(target.trim());
  return m ? { id: m[1].trim(), search: m[2] ?? "" } : null;
}

/** the punctuation Denote drops from titles and keywords (`denote-sluggify-title`) */
const PUNCTUATION = /[\][{}!@#$%^&*()+'"?,.\\|;:~`‘’“”/=]/g;

/**
 * DEN-3: a title as Denote writes it in a file name (`denote-sluggify-title`):
 * punctuation dropped, spaces and `_` as `-`, one `-` at a time, lowercase.
 */
export function slugTitle(title: string): string {
  return title.replace(PUNCTUATION, "").replace(/[_\s]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

/** DEN-3: a keyword as Denote writes it (`denote-sluggify-keyword`): punctuation, spaces, `_` and `-` dropped, lowercase. */
export function slugKeyword(keyword: string): string {
  return keyword.replace(PUNCTUATION, "").replace(/[_\s-]+/g, "").toLowerCase();
}

/** Denote's own identifier form, the only one it writes without `@@`. */
const DATE_ID = /^\d{8}T\d{6}$/;

/**
 * DEN-3: `ID--title__key_words.ext`, leaving out a part that is empty. As
 * Denote does, an identifier that isn't a date (`2610a`) gets `@@` before it:
 * `@@2610a--title.ext`.
 */
export function denoteFileName(id: string, title: string, keywords: string[], ext: string): string {
  const slug = slugTitle(title);
  const keys = keywords.map(slugKeyword).filter(Boolean);
  return `${DATE_ID.test(id) ? "" : "@@"}${id}${slug ? `--${slug}` : ""}${keys.length ? `__${keys.join("_")}` : ""}${ext ? `.${ext}` : ""}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

/** DEN-4: `[2026-10-26 Mon 21:05]`, an inactive Org timestamp in local time, as Denote dates notes. */
export function denoteDate(date: Date): string {
  return `[${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}]`;
}

/** DEN-4: the front matter Denote writes for an Org note; `#+filetags` only when there are keywords. */
export function denoteFrontMatter(title: string, date: Date, keywords: string[], id: string): string {
  const keys = keywords.map(slugKeyword).filter(Boolean);
  return [
    `#+title:      ${title}`,
    `#+date:       ${denoteDate(date)}`,
    ...(keys.length ? [`#+filetags:   :${keys.join(":")}:`] : []),
    `#+identifier: ${id}`,
    "",
    "",
  ].join("\n");
}

/** DEN-5: Denote's own identifier, `YYYYMMDDTHHMMSS` in local time, a second later while one is taken. */
export function timestampId(date: Date, taken: ReadonlySet<string>): string {
  for (let t = date.getTime(); ; t += 1000) {
    const d = new Date(t);
    const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    if (!taken.has(id)) return id;
  }
}

/** DEN-2: every file with a Denote identifier, by identifier; when two share one, the first path in order wins. */
export class DenoteFiles {
  private byId = new Map<string, string[]>();

  constructor(paths: Iterable<string> = []) {
    for (const path of paths) this.add(path);
  }

  add(path: string) {
    const id = denoteIdOf(path);
    if (id === null) return;
    const paths = this.byId.get(id) ?? [];
    if (!paths.includes(path)) paths.push(path);
    paths.sort();
    this.byId.set(id, paths);
  }

  remove(path: string) {
    const id = denoteIdOf(path);
    const paths = id === null ? undefined : this.byId.get(id);
    if (!paths) return;
    const left = paths.filter((p) => p !== path);
    if (left.length) this.byId.set(id!, left);
    else this.byId.delete(id!);
  }

  rename(from: string, to: string) {
    this.remove(from);
    this.add(to);
  }

  path(id: string): string | null {
    return this.byId.get(id)?.[0] ?? null;
  }

  ids(): Set<string> {
    return new Set(this.byId.keys());
  }

  entries(): { id: string; path: string }[] {
    return Array.from(this.byId, ([id, paths]) => ({ id, path: paths[0] }));
  }
}
