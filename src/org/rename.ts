// Links follow renames (§5b): when files move, the file links that pointed at
// them, and the relative links inside a moved note, are rewritten so they
// still point at the same files, always relative to the note (as Org reads them).

import { relativeLinkPath, resolveRelative } from "./syntax";

const REGULAR_LINK = /\[\[((?:[^\[\]\\]|\\.)+)\](\[(?:[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*)\])?\]/g;

/**
 * MV-1: record `oldPath` → `newPath` in a batch of renames. A file renamed
 * twice in one batch maps from where it started to where it ended.
 */
export function addMove(moves: Map<string, string>, oldPath: string, newPath: string) {
  let first = oldPath;
  for (const [from, to] of moves) if (to === oldPath) first = from;
  if (first === newPath) moves.delete(first);
  else moves.set(first, newPath);
}

/**
 * MV-2, MV-3: the note's text with its file links pointing where the files are
 * now, or null when nothing changes. `before` and `after` are the note's own
 * path before and after the renames, `moves` the files that moved, and
 * `exists` says whether a path is a file now.
 *
 * A `file:` link is relative to the note, as in Org, and is always kept
 * pointing at the same file. A plain `[[target]]` is found as LINK-2 finds it:
 * relative to the note, from the vault root, or by file name (with or without
 * `.org`); it is rewritten when that file moved, or when the note moved and it
 * was relative. A rewritten link is always `file:` and relative to the note,
 * with the file's whole name, so Emacs follows it too. ID links, URLs,
 * absolute paths and links inside the file are left alone; a `::search` part
 * is kept.
 */
export function retargetLinks(
  text: string, before: string, after: string, moves: ReadonlyMap<string, string>, exists: (path: string) => boolean,
): string | null {
  if (!text.includes("[[")) return null;
  const byName = new Map<string, string>();
  for (const from of moves.keys()) {
    const name = from.slice(from.lastIndexOf("/") + 1);
    byName.set(name, byName.has(name) ? "" : from); // "": two moved files share the name, so it's no guide
  }
  let changed = false;
  const out = text.replace(REGULAR_LINK, (whole, target: string, desc: string | undefined) => {
    if (target.includes("\\")) return whole;
    const isFile = /^file:/i.test(target);
    const rest = isFile ? target.slice(5) : target;
    // another scheme (id:, https:, attachment:...), an absolute or home path, or a link inside the file
    if (!isFile && /^[a-z][a-z0-9+.-]*:/i.test(rest)) return whole;
    if (/^[/~]/.test(rest) || /^[*#(]/.test(rest)) return whole;
    const cut = rest.indexOf("::");
    const path = cut >= 0 ? rest.slice(0, cut) : rest;
    const search = cut >= 0 ? rest.slice(cut) : "";
    if (!path.trim()) return whole;
    const relative = resolveRelative(before, path);
    let from: string | null = null;
    if (isFile) from = relative;
    else {
      const candidates = [relative, relative && `${relative}.org`, path, `${path}.org`];
      if (!path.includes("/")) candidates.push(byName.get(path) || null, byName.get(`${path}.org`) || null);
      from = candidates.find((c): c is string => Boolean(c && moves.has(c))) ?? null;
      // the note moved: a link relative to it must follow, one found otherwise still is
      if (!from && before !== after && relative !== null) {
        from = [relative, `${relative}.org`].find(exists) ?? null;
      }
    }
    if (from === null) return whole;
    const dest = moves.get(from) ?? from;
    if (dest === from && before === after) return whole;
    const link = relativeLinkPath(after, dest);
    if (/[\[\]]/.test(link)) return whole;
    const rewritten = `[[${isFile ? target.slice(0, 5) : "file:"}${link}${search}]${desc ?? ""}]`;
    if (rewritten === whole) return whole;
    changed = true;
    return rewritten;
  });
  return changed ? out : null;
}
