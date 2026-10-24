// Quick capture (§10c): one box whose text becomes a task (TODO and
// scheduled for today unless changed) at the end of one inbox file, like a
// single org-capture template.

import { orgDateString } from "./edit";
import { linkDescription, NoteRecord } from "./vault-index";

/** CAP-2: the inbox setting as a vault path: slashes trimmed, `.org` added when missing. */
export function capturePath(setting: string): string {
  const path = setting.trim().replace(/^\/+|\/+$/g, "") || "inbox.org";
  return path.endsWith(".org") ? path : `${path}.org`;
}

/**
 * CAP-3: the entry for the typed text: the first non-blank line is the
 * heading, `* <keyword> <line>` (no keyword when it is empty), scheduled for
 * `scheduled` unless that is null; the lines after it are its body. Null when
 * nothing but blanks was typed.
 */
export function captureEntry(text: string, keyword: string, scheduled: Date | null): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return null;
  const body = lines.slice(first + 1);
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const head = `* ${keyword ? `${keyword} ` : ""}${lines[first].trim()}`;
  const planning = scheduled ? [`SCHEDULED: <${orgDateString(scheduled)}>`] : [];
  return [head, ...planning, ...body].join("\n") + "\n";
}

/** CAP-7: the state choices, open keywords first, then done ones, then none (""); each once. */
export function captureStates(todo: string[], done: string[]): string[] {
  return [...new Set([...todo, ...done].filter(Boolean)), ""];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** CAP-8: a date as a date field's value, `YYYY-MM-DD` in local time. */
export function dateFieldValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** CAP-8: a date field's value as a local date; null when empty or not a whole date. */
export function parseDateField(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** CAP-8: `days` after `date`, at midnight. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * CAP-9: the dialog's starting text when it opens from an org note: an empty
 * first line to type the heading on, then a link back to the note, by its
 * file-level ID (`[[id:…][Title]]`), else by its file name.
 */
export function noteCaptureText(note: NoteRecord): string {
  const fileId = note.ids.find((i) => i.offset === 0 && i.heading === undefined)?.id;
  const title = linkDescription(note.title) || note.name;
  const link = fileId !== undefined ? `[[id:${fileId}][${title}]]` : title === note.name ? `[[${note.name}]]` : `[[${note.name}][${title}]]`;
  return `\n${link}`;
}

/** CAP-3: where and what to insert so `entry` starts on a line of its own at the end of `doc`. */
export function appendEntry(doc: string, entry: string): { from: number; insert: string } {
  return { from: doc.length, insert: doc && !doc.endsWith("\n") ? `\n${entry}` : entry };
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;

/**
 * CAP-6: the dialog's text for a capture link's `title`, `text` and `url`.
 * The heading is the title, else the text's first line, else the URL; the
 * rest of the text follows, then the URL as a link.
 * A URL that is only in the text, as phones share it, counts as the URL.
 */
export function sharedCaptureText(params: { title?: string; text?: string; url?: string }): string {
  const title = params.title?.trim() ?? "";
  let url = params.url?.trim() ?? "";
  const lines = (params.text ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!url) {
    const i = lines.findIndex((l) => URL_RE.test(l));
    if (i >= 0) url = lines.splice(i, 1)[0];
  } else {
    const i = lines.indexOf(url);
    if (i >= 0) lines.splice(i, 1);
  }
  const head = title || lines.shift() || url;
  const out = [head, ...lines];
  if (url && url !== head) out.push(`[[${url}]]`);
  return out.join("\n");
}
