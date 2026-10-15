// Editing commands (§9.2, §8). Each takes an EditorState and returns the
// transaction to dispatch, or null when it doesn't apply. They never touch a
// view, so they can be tested with a bare EditorState.

import { ChangeSpec, EditorSelection, EditorState, Text, TransactionSpec } from "@codemirror/state";
import { analyze, headingLevel, isPlanningLine, Keywords, parseHeading } from "./syntax";
import { BoxState, itemLines, nextBullet, parseItem, recountSection, sectionAround, setItemState, toggledState } from "./lists";

export function docLines(doc: Text): string[] {
  const lines: string[] = [];
  for (const line of doc.iterLines()) lines.push(line);
  return lines;
}

/**
 * Changes that turn `before` into `after` (same number of lines), replacing
 * only the part of each line that differs, so the cursor stays put.
 */
export function lineChanges(doc: Text, before: string[], after: string[]): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    if (a === b) continue;
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    const line = doc.line(i + 1);
    changes.push({ from: line.from + start, to: line.to - end, insert: b.slice(start, b.length - end) });
  }
  return changes;
}

function selectedLines(state: EditorState): number[] {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) numbers.add(n);
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Heading level and stars

/** ACT-1: a heading gets one more star; any other line becomes a level-1 heading. */
export function increaseHeadingLevel(state: EditorState): TransactionSpec | null {
  const changes = selectedLines(state).map((n) => {
    const line = state.doc.line(n);
    return headingLevel(line.text) ? { from: line.from, insert: "*" } : { from: line.from, insert: "* " };
  });
  return { changes, userEvent: "input" };
}

/** ACT-2: one star less; a level-1 heading becomes plain text. Other lines are left alone. */
export function decreaseHeadingLevel(state: EditorState): TransactionSpec | null {
  const changes: ChangeSpec[] = [];
  for (const n of selectedLines(state)) {
    const line = state.doc.line(n);
    const level = headingLevel(line.text);
    if (level > 1) {
      changes.push({ from: line.from, to: line.from + 1 });
    } else if (level === 1) {
      const stars = /^\*[ \t]*/.exec(line.text)![0];
      changes.push({ from: line.from, to: line.from + stars.length });
    }
  }
  return changes.length ? { changes, userEvent: "delete" } : null;
}

/** ACT-7: plain line → `* line`, heading → its stars and space removed. */
export function toggleLeadingStars(state: EditorState): TransactionSpec | null {
  const changes = selectedLines(state).map((n) => {
    const line = state.doc.line(n);
    const stars = /^\*+(?:[ \t]+|$)/.exec(line.text);
    return stars ? { from: line.from, to: line.from + stars[0].length } : { from: line.from, insert: "* " };
  });
  return { changes, userEvent: "input" };
}

// ---------------------------------------------------------------------------
// Task state

/** ACT-3: none → first TODO keyword → first DONE keyword → none. */
export function cycleTaskState(state: EditorState, keywords: Keywords): TransactionSpec | null {
  const todo = keywords.todo[0] ?? "TODO";
  const done = keywords.done[0] ?? "DONE";
  const line = state.doc.lineAt(state.selection.main.head);
  const parts = parseHeading(line.text, keywords);
  if (!parts) {
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    return { changes: { from: line.from, to: line.from + indent, insert: `* ${todo} ` }, userEvent: "input" };
  }
  const kw = parts.keyword;
  if (!kw) {
    return { changes: { from: line.from + parts.stars.to, insert: `${todo} ` }, userEvent: "input" };
  }
  if (keywords.todo.includes(kw.text)) {
    return { changes: { from: line.from + kw.from, to: line.from + kw.to, insert: done }, userEvent: "input" };
  }
  let to = kw.to;
  while (to < line.text.length && (line.text[to] === " " || line.text[to] === "\t")) to++;
  return { changes: { from: line.from + kw.from, to: line.from + to }, userEvent: "delete" };
}

// ---------------------------------------------------------------------------
// Planning dates

export type PlanningKind = "SCHEDULED" | "DEADLINE";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD Ddd` in local time, with English weekday names. */
export function orgDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${WEEKDAYS[date.getDay()]}`;
}

const PLANNING_ENTRY_RE = /(SCHEDULED|DEADLINE|CLOSED):[ \t]*([<\[][^>\]\n]*[>\]])/g;

interface PlanningEntry {
  kind: string;
  from: number;
  to: number;
  stamp: string;
  stampFrom: number;
}

function planningEntries(text: string): PlanningEntry[] {
  const entries: PlanningEntry[] = [];
  PLANNING_ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLANNING_ENTRY_RE.exec(text))) {
    entries.push({ kind: m[1], from: m.index, to: m.index + m[0].length, stamp: m[2], stampFrom: m.index + m[0].length - m[2].length });
  }
  return entries;
}

/** The heading enclosing `pos`: the heading line at or above it. */
export function enclosingHeading(doc: Text, pos: number): number | null {
  for (let n = doc.lineAt(pos).number; n >= 1; n--) {
    if (headingLevel(doc.line(n).text)) return n;
  }
  return null;
}

function parseOrgDate(stamp: string): Date | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(stamp);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** The current SCHEDULED/DEADLINE date of the heading around `pos`. */
export function currentPlanningDate(state: EditorState, kind: PlanningKind, pos = state.selection.main.head): Date | null {
  const heading = enclosingHeading(state.doc, pos);
  if (heading === null || heading >= state.doc.lines) return null;
  const next = state.doc.line(heading + 1);
  if (!isPlanningLine(next.text)) return null;
  const entry = planningEntries(next.text).find((e) => e.kind === kind);
  return entry ? parseOrgDate(entry.stamp) : null;
}

/**
 * ACT-5: set (or with `date` null, remove) the SCHEDULED or DEADLINE date of
 * the heading enclosing the cursor. Null when there is no heading above.
 */
export function setPlanningDate(
  state: EditorState,
  kind: PlanningKind,
  date: Date | null,
  pos = state.selection.main.head,
): TransactionSpec | null {
  const doc = state.doc;
  const heading = enclosingHeading(doc, pos);
  if (heading === null) return null;
  const headingLine = doc.line(heading);
  const planning = heading < doc.lines && isPlanningLine(doc.line(heading + 1).text) ? doc.line(heading + 1) : null;
  const day = date ? orgDateString(date) : "";

  if (!planning) {
    if (!date) return null;
    return { changes: { from: headingLine.to, insert: `\n${kind}: <${day}>` }, userEvent: "input" };
  }

  const text = planning.text;
  const entry = planningEntries(text).find((e) => e.kind === kind);
  if (date) {
    if (entry) {
      // keep the time and repeater: replace only the date and weekday
      const m = /\d{4}-\d{2}-\d{2}(?:[ \t]+\p{L}+)?/u.exec(entry.stamp);
      const at = planning.from + entry.stampFrom + (m ? m.index : 1);
      const len = m ? m[0].length : entry.stamp.length - 2;
      return { changes: { from: at, to: at + len, insert: day }, userEvent: "input" };
    }
    const end = text.replace(/[ \t]+$/, "").length;
    return { changes: { from: planning.from + end, insert: ` ${kind}: <${day}>` }, userEvent: "input" };
  }

  if (!entry) return null;
  const rest = (text.slice(0, entry.from) + text.slice(entry.to)).trim();
  if (!rest) {
    // the last entry: the whole line goes, with its line break
    return { changes: { from: headingLine.to, to: planning.to }, userEvent: "delete" };
  }
  let from = entry.from;
  let to = entry.to;
  // remove the space between this entry and its neighbour too
  if (to < text.length && /[ \t]/.test(text[to])) {
    while (to < text.length && /[ \t]/.test(text[to])) to++;
  } else {
    while (from > 0 && /[ \t]/.test(text[from - 1])) from--;
  }
  return { changes: { from: planning.from + from, to: planning.from + to }, userEvent: "delete" };
}

// ---------------------------------------------------------------------------
// Checkboxes

function replaceLines(state: EditorState, lines: string[]): TransactionSpec {
  return { changes: lineChanges(state.doc, docLines(state.doc), lines), userEvent: "input" };
}

/** CHK-5: toggle the box on (0-based) line `n`, with statistics (CHK-6). */
export function toggleBoxOnLine(state: EditorState, n: number): TransactionSpec | null {
  const lines = docLines(state.doc);
  if (!itemLines(lines)[n]) return null;
  const item = parseItem(lines[n]);
  if (!item?.box) return null;
  return replaceLines(state, setItemState(lines, n, toggledState(item.box.state)));
}

/** ACT-6: plain → `- [ ]`, item → adds a box, `[ ]`/`[-]` → `[x]`, `[x]` → box removed. */
export function toggleCheckbox(state: EditorState): TransactionSpec | null {
  const lines = docLines(state.doc);
  const n = state.doc.lineAt(state.selection.main.head).number - 1;
  const text = lines[n];
  if (headingLevel(text) || !itemLines(lines)[n]) return null;
  const item = parseItem(text);
  let next: string[];
  if (!item) {
    const indent = /^[ \t]*/.exec(text)![0];
    lines[n] = `${indent}- [ ] ${text.slice(indent.length)}`;
    next = lines;
  } else if (!item.box) {
    const space = item.textFrom > item.bulletTo ? "" : " ";
    lines[n] = `${text.slice(0, item.textFrom)}${space}[ ] ${text.slice(item.textFrom)}`;
    next = lines;
  } else if (item.box.state === "x") {
    lines[n] = text.slice(0, item.box.from) + text.slice(item.textFrom);
    next = lines;
  } else {
    return replaceLines(state, setItemState(lines, n, "x"));
  }
  const { from, to } = sectionAround(next, n);
  recountSection(next, from, to);
  return replaceLines(state, next);
}

/** CHK-8: Enter inside a list item continues the list. Null where Enter is a plain newline. */
export function continueList(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return null;
  const line = state.doc.lineAt(sel.head);
  const lines = docLines(state.doc);
  const n = line.number - 1;
  if (!itemLines(lines)[n]) return null;
  const item = parseItem(line.text);
  if (!item) return null;
  const offset = sel.head - line.from;
  if (offset < item.textFrom) return null;

  if (!line.text.slice(item.textFrom).trim()) {
    // an empty item ends the list
    const removed = lines.slice();
    removed[n] = "";
    const { from, to } = sectionAround(removed, n);
    recountSection(removed, from, to);
    return {
      changes: lineChanges(state.doc, lines, removed),
      selection: EditorSelection.cursor(line.from),
      userEvent: "input",
    };
  }

  const indent = line.text.slice(0, item.indent);
  const prefix = `${indent}${nextBullet(item.bullet)} ${item.box ? "[ ] " : ""}`;
  const moved = line.text.slice(offset).replace(/^[ \t]+/, "");
  const kept = line.text.slice(0, offset).replace(/[ \t]+$/, "");
  const after = lines.slice(0, n).concat([kept, prefix + moved], lines.slice(n + 1));
  const { from, to } = sectionAround(after, n);
  recountSection(after, from, to);

  // insert the new line, then fix counters on the result, as one change set
  const split = state.changes({ from: line.from + kept.length, to: line.to, insert: `\n${prefix}${moved}` });
  const splitDoc = split.apply(state.doc);
  const recount = state.update({ changes: split }).state.changes(lineChanges(splitDoc, docLines(splitDoc), after));
  const changes = split.compose(recount);
  const cursor = recount.mapPos(line.from + kept.length + 1 + prefix.length, 1);
  return { changes, selection: EditorSelection.cursor(cursor), userEvent: "input", scrollIntoView: true };
}

// ---------------------------------------------------------------------------
// Links

/** ACT-8: `[[id:]]` in place of the selection, the cursor after `id:`. */
export function insertIdLink(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  return {
    changes: { from, to, insert: "[[id:]]" },
    selection: EditorSelection.cursor(from + 5),
    userEvent: "input",
  };
}

/** ACT-9: `[[]]` with the cursor inside, or the selection wrapped as `[[selection]]`. */
export function insertWikiLink(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  if (from === to) {
    return { changes: { from, insert: "[[]]" }, selection: EditorSelection.cursor(from + 2), userEvent: "input" };
  }
  const text = state.sliceDoc(from, to);
  return {
    changes: { from, to, insert: `[[${text}]]` },
    selection: EditorSelection.cursor(from + text.length + 4),
    userEvent: "input",
  };
}

/** Whether line `n` (0-based) is inside a #+begin block. */
export function inBlock(lines: string[], n: number): boolean {
  const kind = analyze(lines).lines[n]?.kind;
  return kind === "block-begin" || kind === "block-content" || kind === "block-end";
}

export type { BoxState };
