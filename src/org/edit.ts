// Editing commands (§9.2, §8). Each takes an EditorState and returns the
// transaction to dispatch, or null when it doesn't apply. They never touch a
// view, so they can be tested with a bare EditorState.

import { ChangeSpec, EditorSelection, EditorState, Text, TransactionSpec } from "@codemirror/state";
import { foldedRanges } from "@codemirror/language";
import { analyze, headingLevel, isPlanningLine, Keywords, parseHeading } from "./syntax";
import { taskStateEdits, type TaskLog } from "./repeat";
import { BoxState, itemExtent, itemLines, nextBullet, parseItem, recountSection, sectionAround, setItemState, shiftItem, toggledState } from "./lists";

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

/**
 * ACT-13: on a list item, indent or outdent the items the selection touches,
 * each with its children (an item inside one already moved goes with it).
 * Null when the selection starts on no list item; an item that can't move
 * that way gives no change, never stars.
 */
function shiftItems(state: EditorState, delta: 1 | -1): TransactionSpec | null | "not-a-list" {
  const before = docLines(state.doc);
  const numbers = selectedLines(state).map((n) => n - 1);
  if (!itemLines(before)[numbers[0]] || !parseItem(before[numbers[0]])) return "not-a-list";
  let lines = before;
  let covered = -1;
  for (const n of numbers) {
    if (n < covered) continue;
    const next = shiftItem(lines, n, delta);
    if (!next) continue;
    covered = itemExtent(next, n);
    lines = next;
  }
  if (lines === before) return null;
  return { changes: lineChanges(state.doc, before, lines), userEvent: delta > 0 ? "input" : "delete" };
}

/** ACT-1: a heading gets one more star; any other line becomes a level-1 heading (on a list item, ACT-13). */
export function increaseHeadingLevel(state: EditorState): TransactionSpec | null {
  const list = shiftItems(state, 1);
  if (list !== "not-a-list") return list;
  const changes = selectedLines(state).map((n) => {
    const line = state.doc.line(n);
    return headingLevel(line.text) ? { from: line.from, insert: "*" } : { from: line.from, insert: "* " };
  });
  return { changes, userEvent: "input" };
}

/** ACT-2: one star less; a level-1 heading becomes plain text (on a list item, ACT-13). Other lines are left alone. */
export function decreaseHeadingLevel(state: EditorState): TransactionSpec | null {
  const list = shiftItems(state, -1);
  if (list !== "not-a-list") return list;
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

/** The task log used when a caller gives none: now, without `CLOSED:`. */
const NO_LOG = (): TaskLog => ({ now: new Date(), logDone: false });

function keywordChange(state: EditorState, n: number, next: string | null, keywords: Keywords, log: TaskLog): TransactionSpec {
  const changes = taskStateEdits(state.doc.toString(), n - 1, next, keywords, log);
  return { changes, userEvent: next === null ? "delete" : "input" };
}

/**
 * ACT-3: none → first TODO keyword → first DONE keyword → none, marking done
 * as Org does (repeating tasks, `CLOSED:`, ACT-14, ACT-15).
 */
export function cycleTaskState(state: EditorState, keywords: Keywords, log: TaskLog = NO_LOG()): TransactionSpec | null {
  const todo = keywords.todo[0] ?? "TODO";
  const done = keywords.done[0] ?? "DONE";
  const line = state.doc.lineAt(state.selection.main.head);
  const parts = parseHeading(line.text, keywords);
  if (!parts) {
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    return { changes: { from: line.from, to: line.from + indent, insert: `* ${todo} ` }, userEvent: "input" };
  }
  const kw = parts.keyword;
  const next = !kw ? todo : keywords.todo.includes(kw.text) ? done : null;
  return keywordChange(state, line.number, next, keywords, log);
}

/**
 * RD-3: in reading mode, tapping a heading's keyword: an open keyword (any
 * TODO-type) → the first DONE keyword, a done one → the first TODO keyword,
 * logged as ACT-14 and ACT-15 say. Null when the line at `pos` is not a
 * heading with a keyword.
 */
export function toggleKeyword(state: EditorState, pos: number, keywords: Keywords, log: TaskLog = NO_LOG()): TransactionSpec | null {
  const line = state.doc.lineAt(pos);
  const kw = parseHeading(line.text, keywords)?.keyword;
  if (!kw) return null;
  const next = kw.done ? (keywords.todo[0] ?? "TODO") : (keywords.done[0] ?? "DONE");
  return keywordChange(state, line.number, next, keywords, log);
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

/** ACT-6: plain → `- [ ]`, item → adds a box, `[ ]`/`[-]` → `[X]`, `[X]` → box removed. */
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

/** ACT-8: `[[id:]]` (DEN-7: `[[denote:]]`) in place of the selection, the cursor after the colon. */
export function insertIdLink(state: EditorState, scheme: "id" | "denote" = "id"): TransactionSpec {
  const { from, to } = state.selection.main;
  return {
    changes: { from, to, insert: `[[${scheme}:]]` },
    selection: EditorSelection.cursor(from + 3 + scheme.length),
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

// ---------------------------------------------------------------------------
// IDs

const PROPERTIES_RE = /^([ \t]*):PROPERTIES:[ \t]*$/i;
const END_RE = /^[ \t]*:END:[ \t]*$/i;
const idRe = (key: string) => new RegExp(`^[ \\t]*:${key}:(?:[ \\t]+(.*?))?[ \\t]*$`, "i");

/** org-id's layout: the value starts in column 11 */
function idLine(indent: string, id: string, key = "ID"): string {
  return `${indent}${`:${key}: `.padEnd(11)}${id}`;
}

/**
 * ACT-10: give the heading enclosing `pos` an `:ID:`, as org-roam's
 * `org-id-get-create` does. Before the first heading, the file gets one.
 * The ID goes into the heading's property drawer (straight after the heading
 * and its planning line) or the file's (on the first line), which is made
 * when missing. Null when there already is an ID.
 */
export function assignId(state: EditorState, id: string, pos = state.selection.main.head, key: "ID" | "CUSTOM_ID" = "ID"): TransactionSpec | null {
  const doc = state.doc;
  const heading = enclosingHeading(doc, pos);
  // DEN-7: a Denote file is named by its identifier; only headings get a CUSTOM_ID
  if (key === "CUSTOM_ID" && heading === null) return null;
  const ID_RE = idRe(key);
  // the drawer goes after line `after` (1-based; 0 is the top of the file)
  const after = heading === null ? 0
    : heading < doc.lines && isPlanningLine(doc.line(heading + 1).text) ? heading + 1 : heading;
  const first = after + 1 <= doc.lines ? doc.line(after + 1) : null;
  const open = first ? PROPERTIES_RE.exec(first.text) : null;
  if (first && open) {
    for (let n = first.number + 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (headingLevel(line.text)) break;
      if (END_RE.test(line.text)) {
        // a closed drawer: fill an empty :ID:, or add one at the top
        for (let m = first.number + 1; m < n; m++) {
          const prop = ID_RE.exec(doc.line(m).text);
          if (!prop) continue;
          if (prop[1]) return null;
          const l = doc.line(m);
          return { changes: { from: l.from, to: l.to, insert: idLine(/^[ \t]*/.exec(l.text)![0], id, key) }, userEvent: "input" };
        }
        return { changes: { from: first.to, insert: "\n" + idLine(open[1], id, key) }, userEvent: "input" };
      }
    }
  }
  const drawer = `:PROPERTIES:\n${idLine("", id, key)}\n:END:`;
  if (after === 0) return { changes: { from: 0, insert: drawer + "\n" }, userEvent: "input" };
  return { changes: { from: doc.line(after).to, insert: "\n" + drawer }, userEvent: "input" };
}

// ---------------------------------------------------------------------------
// New heading

/** The end of the line `from`–`to`, or of the text a fold starting on it hides. */
function endPastFold(state: EditorState, from: number, to: number): number {
  let end = to;
  foldedRanges(state).between(from, to, (f, t) => {
    if (f >= from && f <= to) end = Math.max(end, state.doc.lineAt(t).to);
  });
  return end;
}

/**
 * ACT-11: a new heading at the level of the heading the cursor is under
 * (level 1 above the first heading), with the cursor after its stars. A blank
 * line becomes the heading; otherwise it goes on a new line right below,
 * or below the hidden text when the line is a folded heading.
 */
export function insertHeading(state: EditorState): TransactionSpec {
  const doc = state.doc;
  const line = doc.lineAt(state.selection.main.head);
  const heading = enclosingHeading(doc, line.from);
  const stars = "*".repeat(heading === null ? 1 : headingLevel(doc.line(heading).text)) + " ";
  if (!line.text.trim()) {
    return {
      changes: { from: line.from, to: line.to, insert: stars },
      selection: EditorSelection.cursor(line.from + stars.length),
      userEvent: "input",
      scrollIntoView: true,
    };
  }
  const end = endPastFold(state, line.from, line.to);
  return {
    changes: { from: end, insert: "\n" + stars },
    selection: EditorSelection.cursor(end + 1 + stars.length),
    userEvent: "input",
    scrollIntoView: true,
  };
}

// ---------------------------------------------------------------------------
// Blocks

/**
 * ACT-12: a `#+begin_src` or `#+begin_quote` block. A selection is wrapped,
 * whole lines; otherwise a blank line becomes the block, or it goes on new
 * lines right below (below the hidden text of a folded heading). The cursor
 * goes where the language is typed (src) or on the empty body line (quote).
 */
export function insertBlock(state: EditorState, kind: "src" | "quote"): TransactionSpec {
  const doc = state.doc;
  const begin = `#+begin_${kind}`;
  const end = `#+end_${kind}`;
  const sel = state.selection.main;
  if (!sel.empty) {
    const first = doc.lineAt(sel.from);
    // a selection ending at the start of a line doesn't take that line
    const last = doc.lineAt(sel.to > sel.from && doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to);
    const beginLine = (kind === "src" ? begin + " " : begin) + "\n";
    return {
      changes: [{ from: first.from, insert: beginLine }, { from: last.to, insert: "\n" + end }],
      selection: EditorSelection.cursor(kind === "src" ? first.from + begin.length + 1 : last.to + beginLine.length),
      userEvent: "input",
      scrollIntoView: true,
    };
  }
  const line = doc.lineAt(sel.head);
  const text = `${begin}${kind === "src" ? " " : ""}\n\n${end}`;
  // after "#+begin_src " for src, on the empty line for quote: the same offset
  const cursorIn = begin.length + 1;
  if (!line.text.trim()) {
    return {
      changes: { from: line.from, to: line.to, insert: text },
      selection: EditorSelection.cursor(line.from + cursorIn),
      userEvent: "input",
      scrollIntoView: true,
    };
  }
  const at = endPastFold(state, line.from, line.to);
  return {
    changes: { from: at, insert: "\n" + text },
    selection: EditorSelection.cursor(at + 1 + cursorIn),
    userEvent: "input",
    scrollIntoView: true,
  };
}

/** Whether line `n` (0-based) is inside a #+begin block. */
export function inBlock(lines: string[], n: number): boolean {
  const kind = analyze(lines).lines[n]?.kind;
  return kind === "block-begin" || kind === "block-content" || kind === "block-end";
}

export type { BoxState };

// ---------------------------------------------------------------------------
// Attachments

/**
 * ATT-3: `[[<target>]]` links (`file:<path>`, DEN-8: `denote:<ID>`) in place of the selection, separated by
 * spaces, with a space before them when they would touch a word, and the
 * cursor after them.
 */
export function insertFileLinks(state: EditorState, targets: string[]): TransactionSpec | null {
  if (!targets.length) return null;
  const { from, to } = state.selection.main;
  const before = from > state.doc.lineAt(from).from ? state.sliceDoc(from - 1, from) : "";
  const links = targets.map((t) => `[[${t}]]`).join(" ");
  const insert = (before && !/\s/.test(before) ? " " : "") + links;
  return { changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length), userEvent: "input" };
}

/** What a new file the plugin names is: a voice recording (ATT-4) or an image pasted from the clipboard (ATT-5). */
export type MediaKind = "recording" | "image";

/**
 * ATT-6: the base's names, in local time, as Obsidian names them:
 * `Recording YYYYMMDDHHMMSS.<ext>` and `Pasted image YYYYMMDDHHMMSS.<ext>`.
 */
export function stampedMediaName(kind: MediaKind, date: Date, ext: string): string {
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${kind === "recording" ? "Recording" : "Pasted image"} ${stamp}.${ext}`;
}

const COUNTED_SLUG: Record<MediaKind, string> = { recording: "voice-note", image: "pasted-image" };

/**
 * ATT-6: `YYMM-voice-note-CC.<ext>` or `YYMM-pasted-image-CC.<ext>`, CC
 * counting that month's files of the kind: one more than the highest count
 * among `taken` (the vault's file names), any extension, `YYMM-voice-note`
 * alone counting as 1. Two digits, more past 99.
 */
export function countedMediaName(kind: MediaKind, date: Date, ext: string, taken: ReadonlySet<string>): string {
  const base = `${pad2(date.getFullYear() % 100)}${pad2(date.getMonth() + 1)}-${COUNTED_SLUG[kind]}`;
  const re = new RegExp(`^${base}(?:-(\\d+))?(?:\\.|$)`);
  let count = 0;
  for (const name of taken) {
    const m = re.exec(name);
    if (m) count = Math.max(count, m[1] ? Number(m[1]) : 1);
  }
  return `${base}-${pad2(count + 1)}.${ext}`;
}

/** ATT-4: a recording's file name in the base (ATT-6). */
export function recordingName(date: Date, ext: string): string {
  return stampedMediaName("recording", date, ext);
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
  "image/avif": "avif", "image/apng": "apng", "image/heic": "heic", "image/bmp": "bmp", "image/tiff": "tiff",
};

/** ATT-5: what a paste of `files` saves: nothing when it also carries text, which pastes as text. */
export function pastedFiles<T extends { name: string; type: string }>(files: T[], text: string): T[] {
  return text.trim() ? [] : files;
}

/**
 * ATT-5: whether a pasted file is an image from the clipboard (a screenshot,
 * "Copy image", named `image.png` or nothing), and then its extension from
 * its type; null for a file copied in a file manager, which keeps its name.
 */
export function pastedImageExtension(name: string, mime: string): string | null {
  if (name && !/^image\.\w+$/i.test(name)) return null;
  return IMAGE_EXTENSIONS[mime.split(";")[0].trim().toLowerCase()] ?? (/\.(\w+)$/.exec(name)?.[1] ?? "png");
}

/** ATT-5: the name a pasted file is saved under in the base (ATT-6). */
export function pastedName(name: string, mime: string, date: Date): string {
  const ext = pastedImageExtension(name, mime);
  return ext === null ? name : stampedMediaName("image", date, ext);
}

/**
 * ATT-4: the formats a recorder is asked for, best first. AAC in MP4 is what
 * other apps expect of an `.m4a`; a bare `audio/mp4` comes after WebM because
 * Android records Opus in it, which most players can't open.
 */
const RECORDER_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

/** ATT-4: the first format the device can record, or undefined for its default. */
export function recorderType(supported: (type: string) => boolean): string | undefined {
  return RECORDER_TYPES.find(supported);
}

/**
 * ATT-4: the microphone as a voice memo wants it: echo cancellation, noise
 * suppression and automatic gain are for calls and make a memo sound thin and
 * pumping (on Android they switch the microphone to its call mode).
 */
export const RECORDING_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: 48000,
} as const;

/** ATT-4: the recording's bitrate, as a phone's own recorder makes them. */
export const RECORDING_BITRATE = 128000;

/** ATT-4: the file extension for a recorder's MIME type (`audio/webm;codecs=opus` → `webm`). */
export function recordingExtension(mime: string): string {
  const [type, ...params] = mime.toLowerCase().split(";").map((s) => s.trim());
  // Opus in MP4 isn't what an .m4a holds: name it .mp4 so players don't take it for AAC
  if (type === "audio/mp4" && params.some((p) => /^codecs=.*opus/.test(p))) return "mp4";
  if (type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/aac") return "m4a";
  if (type === "audio/ogg") return "ogg";
  if (type === "audio/wav" || type === "audio/x-wav") return "wav";
  return "webm";
}
