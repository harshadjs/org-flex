// Re-dating an ID (ACT-16): a node's `:ID:` becomes a `ts` style ID at a
// moment the user picks, and every `[[id:…]]` link to it follows.

import { tsId } from "./ids";

/** ACT-16: a `ts` style ID at `date` (to the second, `.000000`), a microsecond later while that one is taken. */
export function datedId(date: Date, taken: ReadonlySet<string>): string {
  return tsId(Math.floor(date.getTime() / 1000) * 1e6, taken);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ACT-16: one spot where `old` is replaced */
export interface IdChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * ACT-16: where `text` names `old`: the `:ID:` property holding it and every
 * link to it (`[[id:old]]`, `[[id:old][…]]`, `[[id:old::search]]`), each as a
 * change to `next`, in order.
 */
export function idChanges(text: string, old: string, next: string): { changes: IdChange[]; links: number; property: boolean } {
  const changes: IdChange[] = [];
  let links = 0;
  let property = false;
  if (!text.includes(old)) return { changes, links, property };
  for (const m of text.matchAll(new RegExp(`^([ \\t]*:ID:[ \\t]+)${escape(old)}[ \\t]*$`, "gim"))) {
    const from = m.index! + m[1].length;
    changes.push({ from, to: from + old.length, insert: next });
    property = true;
  }
  for (const m of text.matchAll(new RegExp(`\\[\\[id:${escape(old)}(?=\\]|::)`, "g"))) {
    const from = m.index! + 5;
    changes.push({ from, to: from + old.length, insert: next });
    links++;
  }
  changes.sort((x, y) => x.from - y.from);
  return { changes, links, property };
}

/** ACT-16: `text` with `idChanges` made; null when nothing in it names `old`. */
export function rewriteId(text: string, old: string, next: string): { text: string; links: number; property: boolean } | null {
  const { changes, links, property } = idChanges(text, old, next);
  if (!changes.length) return null;
  let out = "";
  let at = 0;
  for (const c of changes) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return { text: out + text.slice(at), links, property };
}
