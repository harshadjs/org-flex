// Plain lists and checkboxes (§8). Lists are read line by line: an item is a
// bullet line, and it belongs to the nearest item above it that is indented
// less. Statistics (parent boxes, [n/m] and [n%] cookies) are recomputed for
// a whole section, which runs from one heading to the next.

import { analyze, headingLevel } from "./syntax";

export type BoxState = " " | "x" | "-";

export interface ListItem {
  indent: number;
  /** the bullet as written: "-", "+", "*", "1.", "2)" */
  bullet: string;
  bulletFrom: number;
  bulletTo: number;
  /** the checkbox, with the offsets of "[" and just after "]" */
  box: { from: number; to: number; state: BoxState } | null;
  /** where the item's text starts */
  textFrom: number;
}

const ITEM_RE = /^([ \t]*)([-+*]|\d+[.)])(?=[ \t]|$)/;
const BOX_RE = /^\[([ xX-])\](?=[ \t]|$)/;

/** The list item on a line, or null (CHK-1). */
export function parseItem(text: string): ListItem | null {
  const m = ITEM_RE.exec(text);
  if (!m) return null;
  const indent = m[1].length;
  // "*" at column 0 is a heading
  if (m[2] === "*" && indent === 0) return null;
  const bulletFrom = indent;
  const bulletTo = indent + m[2].length;
  let pos = bulletTo;
  while (pos < text.length && (text[pos] === " " || text[pos] === "\t")) pos++;
  let box: ListItem["box"] = null;
  if (pos > bulletTo) {
    const b = BOX_RE.exec(text.slice(pos));
    if (b) {
      const state = b[1] === "X" ? "x" : (b[1] as BoxState);
      box = { from: pos, to: pos + 3, state };
      pos += 3;
      while (pos < text.length && (text[pos] === " " || text[pos] === "\t")) pos++;
    }
  }
  return { indent, bullet: m[2], bulletFrom, bulletTo, box, textFrom: pos };
}

function indentOf(text: string): number {
  return /^[ \t]*/.exec(text)![0].length;
}

/**
 * For each line of `lines`, whether it may be a list item: false for lines
 * inside or delimiting #+begin blocks (CHK-2).
 */
export function itemLines(lines: string[]): boolean[] {
  const structure = analyze(lines);
  return structure.lines.map((l) => l.kind === "text");
}

interface TreeItem {
  line: number;
  item: ListItem;
  parent: number; // index in items, -1 for top level
}

/** The items of section lines [from, to) with their parents (CHK-3). */
function itemTree(lines: string[], from: number, to: number, allowed: boolean[]): TreeItem[] {
  const items: TreeItem[] = [];
  const stack: number[] = [];
  for (let n = from; n < to; n++) {
    const text = lines[n];
    if (!text.trim()) continue;
    const item = allowed[n] ? parseItem(text) : null;
    const indent = item ? item.indent : indentOf(text);
    while (stack.length && items[stack[stack.length - 1]].item.indent >= indent) stack.pop();
    if (item) {
      items.push({ line: n, item, parent: stack.length ? stack[stack.length - 1] : -1 });
      stack.push(items.length - 1);
    }
  }
  return items;
}

/** The section around line `n`: [heading line or 0, next heading line or end). */
export function sectionAround(lines: string[], n: number): { from: number; to: number } {
  let from = n;
  while (from > 0 && !headingLevel(lines[from])) from--;
  let to = n + 1;
  while (to < lines.length && !headingLevel(lines[to])) to++;
  return { from, to };
}

const COOKIE_RE = /\[(\d*)\/(\d*)\]|\[(\d*)%\]/g;

function writeCookies(text: string, from: number, done: number, total: number): string {
  return text.slice(0, from) + text.slice(from).replace(COOKIE_RE, (_m, _a, _b, pct) =>
    pct !== undefined
      ? `[${total ? Math.floor((done * 100) / total) : 0}%]`
      : `[${done}/${total}]`,
  );
}

function setBox(text: string, item: ListItem, state: BoxState): string {
  if (!item.box) return text;
  return text.slice(0, item.box.from + 1) + state + text.slice(item.box.from + 2);
}

/**
 * Recompute parent boxes and cookies in section lines [from, to) (CHK-6).
 * Only direct children count. The heading at `from` gets the counts of the
 * top-level items. Returns the new lines (the array is changed in place).
 */
export function recountSection(lines: string[], from: number, to: number, allowed = itemLines(lines)): string[] {
  const items = itemTree(lines, from, to, allowed);
  // children come after their parent, so going backwards settles them first
  for (let i = items.length - 1; i >= -1; i--) {
    const children = items.filter((c) => c.parent === i);
    const boxed = children.map((c) => parseItem(lines[c.line])!).filter((c) => c.box);
    const done = boxed.filter((c) => c.box!.state === "x").length;
    if (i === -1) {
      if (headingLevel(lines[from])) lines[from] = writeCookies(lines[from], 0, done, boxed.length);
      continue;
    }
    const line = items[i].line;
    let item = parseItem(lines[line])!;
    if (item.box && boxed.length) {
      const partial = boxed.some((c) => c.box!.state === "-");
      const state: BoxState = done === boxed.length ? "x" : done || partial ? "-" : " ";
      lines[line] = setBox(lines[line], item, state);
      item = parseItem(lines[line])!;
    }
    lines[line] = writeCookies(lines[line], item.textFrom, done, boxed.length);
  }
  return lines;
}

/**
 * Set the box of the item on line `n` and of every box nested under it, then
 * recount the section. Returns the new lines; the input is not changed.
 */
export function setItemState(input: string[], n: number, state: BoxState): string[] {
  const lines = input.slice();
  const allowed = itemLines(lines);
  const { from, to } = sectionAround(lines, n);
  const items = itemTree(lines, from, to, allowed);
  const index = items.findIndex((i) => i.line === n);
  if (index < 0) return lines;
  const below = new Set([index]);
  for (let i = index + 1; i < items.length; i++) {
    if (below.has(items[i].parent)) below.add(i);
  }
  for (const i of below) {
    const { line, item } = items[i];
    lines[line] = setBox(lines[line], item, state);
  }
  return recountSection(lines, from, to, allowed);
}

/** The state a click on a box leads to (CHK-5). */
export function toggledState(state: BoxState): BoxState {
  return state === "x" ? " " : "x";
}

/** The bullet for the item after one with `bullet`: ordered bullets count up. */
export function nextBullet(bullet: string): string {
  const m = /^(\d+)([.)])$/.exec(bullet);
  return m ? `${Number(m[1]) + 1}${m[2]}` : bullet;
}
