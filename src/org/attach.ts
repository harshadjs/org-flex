// Org attachments (§9a, ATT-7): org-attach's ID folders, as the Emacs config
// sets them up (`org-attach-id-dir`, `org-attach-use-inheritance t`). A node's
// files live in `<dir>/<first 2 of its ID>/<rest of its ID>/` and are linked
// as `[[attachment:NAME]]` from inside that node.

/** org-attach's own default `org-attach-id-dir` */
export const DEFAULT_ATTACH_DIR = "data";

/** ATT-7: a node's attachment folder, a vault path: org-attach's `org-attach-id-uuid-folder-format`. */
export function attachDirFor(root: string, id: string): string {
  const dir = root.replace(/^\/+|\/+$/g, "");
  const rest = `${id.slice(0, 2)}/${id.slice(2)}`;
  return dir ? `${dir}/${rest}` : rest;
}

const HEADING_RE = /^(\*+)[ \t]/;
const PLANNING_RE = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const PROPERTIES_RE = /^[ \t]*:PROPERTIES:[ \t]*$/i;
const END_RE = /^[ \t]*:END:[ \t]*$/i;
const ID_RE = /^[ \t]*:ID:[ \t]+(\S+)[ \t]*$/i;

/** the `:ID:` in the property drawer starting at line `n` (0-based), or null */
function drawerId(line: (n: number) => string, count: number, n: number): string | null {
  if (n >= count || !PROPERTIES_RE.test(line(n))) return null;
  for (let m = n + 1; m < count; m++) {
    const text = line(m);
    if (END_RE.test(text) || HEADING_RE.test(text)) return null;
    const id = ID_RE.exec(text);
    if (id) return id[1];
  }
  return null;
}

/**
 * ATT-7: the ID that owns attachments on line `at` (0-based): the nearest
 * heading above it, or one of that heading's ancestors, with an `:ID:`, else
 * the file's own (a drawer on the first line); null when none has one.
 * `line(n)` gives line `n` of `count`. As org-attach finds it with
 * inheritance, and as org-roam takes a link's source.
 */
export function attachOwner(line: (n: number) => string, count: number, at: number): { id: string; heading: number | null } | null {
  let level = Infinity;
  for (let n = Math.min(at, count - 1); n >= 0; n--) {
    const h = HEADING_RE.exec(line(n));
    if (!h || h[1].length >= level) continue;
    level = h[1].length;
    const drawer = n + 1 < count && PLANNING_RE.test(line(n + 1)) ? n + 2 : n + 1;
    const id = drawerId(line, count, drawer);
    if (id) return { id, heading: n };
    if (level === 1) break;
  }
  const id = drawerId(line, count, 0);
  return id ? { id, heading: null } : null;
}

/** ATT-7: the name an `attachment:` link names (`::search` dropped), or null for another kind of link. */
export function attachmentName(target: string): string | null {
  const m = /^attachment:(.+)$/i.exec(target.trim());
  if (!m) return null;
  const name = m[1].split("::")[0].trim();
  return name || null;
}

/** ATT-7: the vault path an `attachment:` link on line `at` names, or null when it isn't one or no node owns it. */
export function resolveAttachment(target: string, root: string, line: (n: number) => string, count: number, at: number): string | null {
  const name = attachmentName(target);
  if (name === null) return null;
  const owner = attachOwner(line, count, at);
  return owner ? `${attachDirFor(root, owner.id)}/${name}` : null;
}

/** ATT-7: a heading line with the `ATTACH` tag added, as org-attach tags a heading that owns files; unchanged when it has it. */
export function withAttachTag(heading: string): string {
  const m = /^(.*?)([ \t]+)(:(?:[\w@#%]+:)+)[ \t]*$/.exec(heading);
  if (m) {
    const tags = m[3].slice(1, -1).split(":");
    return tags.includes("ATTACH") ? heading : `${m[1]}${m[2]}:${[...tags, "ATTACH"].join(":")}:`;
  }
  return `${heading.replace(/[ \t]+$/, "")} :ATTACH:`;
}

/** ATT-7: `dir/name`, or `dir/stem-2.ext`, `-3`... while `taken` says the path exists. */
export function freeAttachmentPath(dir: string, name: string, taken: (path: string) => boolean): string {
  if (!taken(`${dir}/${name}`)) return `${dir}/${name}`;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const path = `${dir}/${stem}-${n}${ext}`;
    if (!taken(path)) return path;
  }
}
