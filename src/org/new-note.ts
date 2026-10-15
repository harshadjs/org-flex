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
