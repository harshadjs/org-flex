// New org notes (§10a): the title is the file name and the #+title; the
// :ID: is a fresh UUID, as org-roam makes it.

const FORBIDDEN = /[\\/:*?"<>|#^\[\]]/;

/** NOTE-3: why a title can't be used, or null when it's fine. */
export function titleProblem(raw: string): string | null {
  const title = raw.trim();
  if (!title) return "Enter a title.";
  const bad = FORBIDDEN.exec(title);
  if (bad) return `A title can't contain "${bad[0]}".`;
  if (title.startsWith(".") || title.endsWith(".")) return "A title can't start or end with a dot.";
  return null;
}

/** NOTE-3: `<folder>/<title>.org`, with the title trimmed. */
export function notePath(folder: string, raw: string): string {
  const dir = folder.replace(/^\/+|\/+$/g, "");
  const name = `${raw.trim()}.org`;
  return dir ? `${dir}/${name}` : name;
}

/** NOTE-5: the journal header without filetags, with `id` (a UUID) as the :ID:. */
export function noteFileContent(raw: string, id: string): string {
  const title = raw.trim();
  return `:PROPERTIES:\n:ID:       ${id}\n:END:\n#+title: ${title}\n\n`;
}

/**
 * LP-10: a file name for a title typed in the `[[` list: characters NOTE-3
 * refuses become "-", and leading and trailing dots are dropped.
 */
export function noteFileName(raw: string): string {
  const name = raw.trim().replace(new RegExp(FORBIDDEN.source, "g"), "-").replace(/^\.+|\.+$/g, "").trim();
  return name || "Untitled";
}

/** LP-10: `<name>.org`, or `<name> 2.org`, `<name> 3.org`, … when taken. */
export function freeNotePath(folder: string, name: string, taken: (path: string) => boolean): string {
  for (let n = 1; ; n++) {
    const path = notePath(folder, n === 1 ? name : `${name} ${n}`);
    if (!taken(path)) return path;
  }
}

/**
 * LP-10, FIND-2: whether to offer creating a note titled `typed`: when
 * something is typed and no entry has exactly that label (ignoring case and
 * spaces around it).
 */
export function offerCreate(labels: Iterable<string>, typed: string): boolean {
  const title = typed.trim().toLowerCase();
  if (!title) return false;
  for (const label of labels) if (label.trim().toLowerCase() === title) return false;
  return true;
}
