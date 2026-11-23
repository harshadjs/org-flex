// Re-dating a node (ACT-16): its `:CREATED:` becomes a moment the user picks.
// The `:ID:` stays, so no link changes (IDX-4: a node's time is its
// `:CREATED:`, not its ID).

/** ACT-16: one spot of a file that changes */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ACT-16: the change that sets `:CREATED:` to `stamp` in the property drawer
 * whose `:ID:` is `id`: its `:CREATED:` line is rewritten, or one is added
 * straight after the `:ID:` line, with its indentation. Null when no drawer
 * in `text` has that ID.
 */
export function createdChange(text: string, id: string, stamp: string): TextChange | null {
  const lines = text.split("\n");
  const idRe = new RegExp(`^([ \\t]*):ID:[ \\t]+${escape(id)}[ \\t]*$`, "i");
  const at = lines.findIndex((l) => idRe.test(l));
  if (at < 0) return null;
  const indent = idRe.exec(lines[at])![1];
  const start = (n: number) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  let first = at;
  while (first > 0 && !/^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[first])) first--;
  for (let n = first + 1; n < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[n]) && !/^\*+[ \t]/.test(lines[n]); n++) {
    const m = /^([ \t]*):CREATED:/i.exec(lines[n]);
    if (m) return { from: start(n), to: start(n) + lines[n].length, insert: `${m[1]}:CREATED:  ${stamp}` };
  }
  const end = start(at) + lines[at].length;
  return { from: end, to: end, insert: `\n${indent}:CREATED:  ${stamp}` };
}

/** ACT-16: `text` with `createdChange` made; null when no drawer has `id`. */
export function setCreated(text: string, id: string, stamp: string): string | null {
  const c = createdChange(text, id, stamp);
  return c ? text.slice(0, c.from) + c.insert + text.slice(c.to) : null;
}
