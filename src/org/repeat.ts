// Marking tasks done as Org does (ACT-14, ACT-15) and repeating timestamps
// (`+1w`, `++1w`, `.+1d`), which the agenda also expands (AG-2, TASK-5).
// Pure: it works on the file's text and gives back edits to it.

import { isPlanningLine, Keywords, parseHeading } from "./syntax";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Apply edits (against the original text, not overlapping) to it. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** `[2026-10-29 Thu 09:12]`, an inactive timestamp with the time, as `org-log-done 'time` writes it. */
export function inactiveNow(now: Date): string {
  return `[${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${WEEKDAYS[now.getDay()]} ${pad2(now.getHours())}:${pad2(now.getMinutes())}]`;
}

export type RepeatKind = "+" | "++" | ".+";
export interface Repeater {
  kind: RepeatKind;
  n: number;
  unit: "h" | "d" | "w" | "m" | "y";
}

/** The date, time and repeater in a timestamp's text (`<2026-10-30 Fri 10:00 +1w>`). */
export interface Stamp {
  date: Date;
  /** a time was given */
  timed: boolean;
  repeat: Repeater | null;
  /** where the date (and weekday, and time) is, inside the text */
  from: number;
  to: number;
}

const STAMP_BODY_RE = /(\d{4})-(\d{2})-(\d{2})(?:[ \t]+\p{L}+\.?)?(?:[ \t]+(\d{1,2}):(\d{2}))?/u;
const REPEAT_RE = /(?:^|[ \t])(\.\+|\+\+|\+)(\d+)([hdwmy])(?=[ \t>\]/]|$)/;

export function parseStamp(text: string): Stamp | null {
  const m = STAMP_BODY_RE.exec(text);
  if (!m) return null;
  const timed = m[4] !== undefined;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), timed ? Number(m[4]) : 0, timed ? Number(m[5]) : 0);
  const r = REPEAT_RE.exec(text.slice(m.index + m[0].length));
  const repeat = r && Number(r[2]) > 0 ? { kind: r[1] as RepeatKind, n: Number(r[2]), unit: r[3] as Repeater["unit"] } : null;
  return { date, timed, repeat, from: m.index, to: m.index + m[0].length };
}

/** `date` moved `times` steps of the repeater. Months and years keep the day of the month, as Emacs does. */
export function addRepeat(date: Date, r: Repeater, times = 1): Date {
  const d = new Date(date);
  const n = r.n * times;
  if (r.unit === "h") d.setHours(d.getHours() + n);
  else if (r.unit === "d") d.setDate(d.getDate() + n);
  else if (r.unit === "w") d.setDate(d.getDate() + 7 * n);
  else if (r.unit === "m") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d;
}

/**
 * ACT-14: the next date of a repeating timestamp, done at `now`: `+` one step
 * on; `++` as many steps as it takes to be after now; `.+` one step from now
 * (keeping the timestamp's time of day).
 */
export function nextRepeat(stamp: Stamp, now: Date): Date {
  const r = stamp.repeat!;
  if (r.kind === "+") return addRepeat(stamp.date, r);
  if (r.kind === ".+") {
    const base = r.unit === "h" ? new Date(now)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), stamp.date.getHours(), stamp.date.getMinutes());
    return addRepeat(base, r);
  }
  let d = addRepeat(stamp.date, r);
  while (d.getTime() <= now.getTime()) d = addRepeat(d, r);
  return d;
}

/** A date as a timestamp writes it: `2026-10-30 Fri`, with ` 10:00` when it has a time. */
function stampDate(d: Date, timed: boolean): string {
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${WEEKDAYS[d.getDay()]}`;
  return timed ? `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : day;
}

const PLANNING_ENTRY_RE = /(SCHEDULED|DEADLINE|CLOSED):[ \t]*([<\[][^>\]\n]*[>\]])/g;

interface Line {
  text: string;
  from: number;
  to: number;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let from = 0;
  for (const t of text.split("\n")) {
    out.push({ text: t, from, to: from + t.length });
    from += t.length + 1;
  }
  return out;
}

/** Removing one planning entry: the whole line (with its line break) when it is the last one. */
function removeEntry(lines: Line[], p: number, entry: { from: number; to: number }): TextEdit {
  const line = lines[p];
  const text = line.text;
  if (!(text.slice(0, entry.from) + text.slice(entry.to)).trim()) return { from: lines[p - 1].to, to: line.to, insert: "" };
  let from = entry.from;
  let to = entry.to;
  if (to < text.length && /[ \t]/.test(text[to])) {
    while (to < text.length && /[ \t]/.test(text[to])) to++;
  } else {
    while (from > 0 && /[ \t]/.test(text[from - 1])) from--;
  }
  return { from: line.from + from, to: line.from + to, insert: "" };
}

export interface TaskLog {
  now: Date;
  /** ACT-15: write `CLOSED:` when a task is done (`org-log-done 'time`) */
  logDone: boolean;
}

/**
 * ACT-3, ACT-14, ACT-15: the edits that set the keyword of the heading on
 * (0-based) line `n` to `next` (null removes it), as Org does it:
 * - a task that becomes done while a SCHEDULED or DEADLINE date repeats stays
 *   open: the repeating dates move on, `:LAST_REPEAT:` is set and a
 *   `- State "DONE" from "TODO" [time]` line is added under the heading;
 * - otherwise, with `logDone`, becoming done writes `CLOSED: [time]` first on
 *   the planning line; leaving the done keywords removes `CLOSED:`.
 * Empty when the line is no heading.
 */
export function taskStateEdits(text: string, n: number, next: string | null, keywords: Keywords, log: TaskLog): TextEdit[] {
  const lines = linesOf(text);
  const heading = lines[n];
  const parts = heading && parseHeading(heading.text, keywords);
  if (!parts) return [];
  const kw = parts.keyword;
  const wasDone = !!kw?.done;
  const willDone = next !== null && keywords.done.includes(next) && !keywords.todo.includes(next);
  const p = n + 1 < lines.length && isPlanningLine(lines[n + 1].text) ? n + 1 : null;
  const entries: { kind: string; from: number; to: number; stamp: string; stampFrom: number }[] = [];
  if (p !== null) {
    PLANNING_ENTRY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLANNING_ENTRY_RE.exec(lines[p].text))) {
      entries.push({ kind: m[1], from: m.index, to: m.index + m[0].length, stamp: m[2], stampFrom: m.index + m[0].length - m[2].length });
    }
  }
  const keywordEdit = (word: string | null): TextEdit[] => {
    if (word === (kw?.text ?? null)) return [];
    if (!kw) return [{ from: heading.from + parts.stars.to, to: heading.from + parts.stars.to, insert: `${word} ` }];
    if (word) return [{ from: heading.from + kw.from, to: heading.from + kw.to, insert: word }];
    let to = kw.to;
    while (to < heading.text.length && /[ \t]/.test(heading.text[to])) to++;
    return [{ from: heading.from + kw.from, to: heading.from + to, insert: "" }];
  };

  const repeating = !wasDone && willDone
    ? entries.filter((e) => e.kind !== "CLOSED" && e.stamp.startsWith("<")).map((e) => ({ e, s: parseStamp(e.stamp) })).filter((x) => x.s?.repeat)
    : [];
  if (repeating.length) {
    const edits = keywordEdit(kw ? kw.text : (keywords.todo[0] ?? "TODO"));
    const base = lines[p!].from;
    for (const { e, s } of repeating) {
      edits.push({ from: base + e.stampFrom + s!.from, to: base + e.stampFrom + s!.to, insert: stampDate(nextRepeat(s!, log.now), s!.timed) });
    }
    // after the planning line: a property drawer gets :LAST_REPEAT:, and the state line goes after the drawers
    const at = inactiveNow(log.now);
    let i = p! + 1;
    let insertAfterPlanning = "";
    const drawerStart = lines[i] && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[i].text) ? i : null;
    let drawerEnd: number | null = null;
    if (drawerStart !== null) {
      for (let j = drawerStart + 1; j < lines.length && !parseHeading(lines[j].text, keywords); j++) {
        if (/^[ \t]*:END:[ \t]*$/i.test(lines[j].text)) { drawerEnd = j; break; }
      }
    }
    if (drawerStart !== null && drawerEnd !== null) {
      const existing = lines.slice(drawerStart + 1, drawerEnd).findIndex((l) => /^[ \t]*:LAST_REPEAT:/i.test(l.text));
      if (existing >= 0) {
        const l = lines[drawerStart + 1 + existing];
        edits.push({ from: l.from, to: l.to, insert: `:LAST_REPEAT: ${at}` });
      } else {
        edits.push({ from: lines[drawerEnd].from, to: lines[drawerEnd].from, insert: `:LAST_REPEAT: ${at}\n` });
      }
      i = drawerEnd + 1;
    } else {
      insertAfterPlanning = `\n:PROPERTIES:\n:LAST_REPEAT: ${at}\n:END:`;
    }
    // other drawers (LOGBOOK...) stay above the note
    for (;;) {
      if (!lines[i] || !/^[ \t]*:[\w-]+:[ \t]*$/.test(lines[i].text) || /^[ \t]*:END:/i.test(lines[i].text)) break;
      let j = i + 1;
      while (j < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[j].text) && !parseHeading(lines[j].text, keywords)) j++;
      if (j >= lines.length || parseHeading(lines[j].text, keywords)) break;
      i = j + 1;
    }
    const state = `- State ${`"${next}"`.padEnd(12)} from ${`"${kw?.text ?? ""}"`.padEnd(12)} ${at}`;
    const afterDrawers = i - 1 === p! ? null : lines[i - 1];
    if (afterDrawers === null) {
      edits.push({ from: lines[p!].to, to: lines[p!].to, insert: `${insertAfterPlanning}\n${state}` });
    } else {
      if (insertAfterPlanning) edits.push({ from: lines[p!].to, to: lines[p!].to, insert: insertAfterPlanning });
      edits.push({ from: afterDrawers.to, to: afterDrawers.to, insert: `\n${state}` });
    }
    return edits;
  }

  const edits = keywordEdit(next);
  const closed = entries.find((e) => e.kind === "CLOSED");
  if (!wasDone && willDone && log.logDone) {
    const entry = `CLOSED: ${inactiveNow(log.now)}`;
    if (closed) {
      edits.push({ from: lines[p!].from + closed.stampFrom, to: lines[p!].from + closed.to, insert: inactiveNow(log.now) });
    } else if (p !== null) {
      const indent = /^[ \t]*/.exec(lines[p].text)![0].length;
      edits.push({ from: lines[p].from + indent, to: lines[p].from + indent, insert: `${entry} ` });
    } else {
      edits.push({ from: heading.to, to: heading.to, insert: `\n${entry}` });
    }
  } else if (wasDone && !willDone && closed) {
    edits.push(removeEntry(lines, p!, closed));
  }
  return edits;
}

/** AG-2, TASK-5: whether a timestamp (repeating or not) falls on the day starting at `day`. */
export function occursOn(stamp: Stamp, day: Date): boolean {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const first = stamp.date.getTime();
  if (first >= end) return false;
  if (first >= start) return true;
  if (!stamp.repeat || stamp.repeat.unit === "h") return false;
  // the step count that lands nearest the day, then check it and the one after
  const r = stamp.repeat;
  const days: Record<string, number> = { d: 1, w: 7, m: 30.44, y: 365.25 };
  const perStep = days[r.unit] * r.n * 86400000;
  let k = Math.max(1, Math.floor((start - first) / perStep) - 1);
  for (let tries = 0; tries < 4; tries++, k++) {
    const t = addRepeat(stamp.date, r, k).getTime();
    if (t >= end) return false;
    if (t >= start) return true;
  }
  return false;
}
