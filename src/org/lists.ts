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

/** CHK-6: a box that changes state is written `[ ]`, `[-]` or `[X]` (as Emacs does); one that keeps its state is left as written. */
function setBox(text: string, item: ListItem, state: BoxState): string {
  if (!item.box || item.box.state === state) return text;
  return text.slice(0, item.box.from + 1) + (state === "x" ? "X" : state) + text.slice(item.box.from + 2);
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

// ---------------------------------------------------------------------------
// Moving items (§8)

/** CHK-10: the item on line `n` with everything nested under it, [n, end); trailing blank lines are left out. */
export function itemExtent(lines: string[], n: number): number {
  const indent = parseItem(lines[n])?.indent ?? indentOf(lines[n]);
  let end = n + 1;
  for (let m = n + 1; m < lines.length; m++) {
    const text = lines[m];
    if (headingLevel(text)) break;
    if (!text.trim()) continue;
    if (indentOf(text) <= indent) break;
    end = m + 1;
  }
  return end;
}

interface ListInfo {
  from: number;
  to: number;
  /** every item of the section, with parents as indices into it */
  tree: TreeItem[];
  /** the indices in `tree` of this list's items */
  items: number[];
  /** each item's nesting depth, by index in `tree` */
  depth: number[];
}

/** CHK-10: the whole list around the item on line `n`: top-level items with only blank lines between them. */
function listAround(lines: string[], n: number, allowed: boolean[]): ListInfo | null {
  const section = sectionAround(lines, n);
  const tree = itemTree(lines, section.from, section.to, allowed);
  let index = tree.findIndex((i) => i.line === n);
  if (index < 0) return null;
  while (tree[index].parent >= 0) index = tree[index].parent;
  const roots = tree.filter((i) => i.parent === -1);
  let first = roots.indexOf(tree[index]);
  let last = first;
  const joined = (a: TreeItem, b: TreeItem) => {
    for (let m = itemExtent(lines, a.line); m < b.line; m++) if (lines[m].trim()) return false;
    return true;
  };
  while (first > 0 && joined(roots[first - 1], roots[first])) first--;
  while (last + 1 < roots.length && joined(roots[last], roots[last + 1])) last++;
  const from = roots[first].line;
  const to = itemExtent(lines, roots[last].line);
  const depth: number[] = [];
  tree.forEach((i, k) => (depth[k] = i.parent < 0 ? 0 : depth[i.parent] + 1));
  const items = tree.flatMap((i, k) => (i.line >= from && i.line < to ? [k] : []));
  return { from, to, tree, items, depth };
}

/** Where an item's children start: one space after its bullet ("match the bullet"). */
function contentColumn(item: ListItem): number {
  return item.bulletTo + 1;
}

export interface DropSlot {
  /** the line the item goes before (the list's end for the last slot) */
  line: number;
  /** the indentations it may take there, shallowest first */
  indents: number[];
  /** the nesting depth of the first of them; each next one is one deeper */
  minDepth: number;
  /** the slot it is already in */
  original: boolean;
}

/**
 * CHK-10, CHK-11: the places the item on line `n` can be dropped, within its
 * own list. At each, it can nest at most one level below the item above, and
 * no shallower than the item below (which it would otherwise take as a child).
 */
export function dropSlots(lines: string[], n: number, allowed = itemLines(lines)): DropSlot[] {
  if (!allowed[n] || !parseItem(lines[n])) return [];
  const list = listAround(lines, n, allowed);
  if (!list) return [];
  const { tree, depth } = list;
  const end = itemExtent(lines, n);
  const rest = list.items.filter((k) => tree[k].line < n || tree[k].line >= end);
  if (!rest.length) return [];
  const rootIndent = tree[list.items[0]].item.indent;
  const slots: DropSlot[] = [];
  for (let j = 0; j <= rest.length; j++) {
    const above = rest[j - 1];
    const below = rest[j];
    const max = above === undefined ? 0 : depth[above] + 1;
    const min = below === undefined ? 0 : Math.min(depth[below], max);
    // the item above and its ancestors, root first
    const chain: TreeItem[] = [];
    for (let k = above ?? -1; k >= 0; k = tree[k].parent) chain.unshift(tree[k]);
    const indents: number[] = [];
    for (let d = min; d <= max; d++) indents.push(d === 0 ? rootIndent : contentColumn(chain[d - 1].item));
    const original = (above === undefined || tree[above].line < n) && (below === undefined || tree[below].line >= end);
    slots.push({ line: below === undefined ? list.to : tree[below].line, indents, minDepth: min, original });
  }
  return slots;
}

/** CHK-12: ordered siblings in the list around line `n` count up from the lowest number among them. */
function renumber(lines: string[], n: number, allowed: boolean[]) {
  const list = listAround(lines, n, allowed);
  if (!list) return;
  const ordered = list.items.map((k) => list.tree[k]).flatMap((i) => {
    const m = /^(\d+)([.)])$/.exec(i.item.bullet);
    return m ? [{ ...i, number: Number(m[1]), delimiter: m[2] }] : [];
  });
  const next = new Map<number, number>();
  for (const i of ordered) next.set(i.parent, Math.min(next.get(i.parent) ?? Infinity, i.number));
  for (const { line, item, parent, delimiter } of ordered) {
    const number = next.get(parent)!;
    next.set(parent, number + 1);
    const text = lines[line];
    lines[line] = text.slice(0, item.bulletFrom) + `${number}${delimiter}` + text.slice(item.bulletTo);
  }
}

/**
 * CHK-10..12: move the item on line `n`, with its children, before line
 * `slot.line` at `indent`. The children keep their indentation relative to
 * it; ordered lists are renumbered and statistics recounted. Returns the new
 * lines (same number of lines), or null when nothing would change.
 */
export function moveItem(input: string[], n: number, slot: DropSlot, indent: number): string[] | null {
  const item = parseItem(input[n]);
  if (!item) return null;
  const delta = indent - item.indent;
  if (slot.original && delta === 0) return null;
  const end = itemExtent(input, n);
  const block = input.slice(n, end).map((t) =>
    !t.trim() ? t : delta >= 0 ? " ".repeat(delta) + t : t.slice(Math.min(-delta, indentOf(t))));
  let lines: string[];
  let at: number;
  if (slot.original) {
    lines = [...input.slice(0, n), ...block, ...input.slice(end)];
    at = n;
  } else if (slot.line >= end) {
    lines = [...input.slice(0, n), ...input.slice(end, slot.line), ...block, ...input.slice(slot.line)];
    at = slot.line - (end - n);
  } else {
    lines = [...input.slice(0, slot.line), ...block, ...input.slice(slot.line, n), ...input.slice(end)];
    at = slot.line;
  }
  const allowed = itemLines(lines);
  renumber(lines, at, allowed);
  const { from, to } = sectionAround(lines, at);
  return recountSection(lines, from, to, allowed);
}

/**
 * ACT-13: indent (+1) or outdent (-1) the item on line `n` by one level, with
 * its children, as dragging it sideways does (CHK-11, CHK-12): one level
 * deeper nests it under the item above, one shallower makes it a sibling of
 * its parent. Returns the new lines, or null when it can't go that way (the
 * first item of a list can't be indented; an item can't be outdented past
 * the top level, or while a later sibling would become its child).
 */
export function shiftItem(lines: string[], n: number, delta: 1 | -1, allowed = itemLines(lines)): string[] | null {
  const item = allowed[n] ? parseItem(lines[n]) : null;
  if (!item) return null;
  const slot = dropSlots(lines, n, allowed).find((s) => s.original);
  if (!slot) return null;
  const target = delta > 0
    ? slot.indents.find((i) => i > item.indent)
    : [...slot.indents].reverse().find((i) => i < item.indent);
  return target === undefined ? null : moveItem(lines, n, slot, target);
}

/**
 * CHK-13: for each line, the nesting depth of the list item it shows (0 at
 * the top level), the depth of the item whose text continues on it for a
 * nested non-item line, or -1 (not in a list, blank, inside a block).
 */
export function listDepths(lines: string[], allowed = itemLines(lines)): number[] {
  const out = lines.map(() => -1);
  const stack: { indent: number; depth: number }[] = [];
  for (let n = 0; n < lines.length; n++) {
    const text = lines[n];
    if (headingLevel(text)) {
      stack.length = 0;
      continue;
    }
    if (!text.trim()) continue;
    const item = allowed[n] ? parseItem(text) : null;
    const indent = item ? item.indent : indentOf(text);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (item) {
      out[n] = stack.length;
      stack.push({ indent, depth: stack.length });
    } else if (stack.length && allowed[n]) {
      out[n] = stack[stack.length - 1].depth;
    }
  }
  return out;
}
