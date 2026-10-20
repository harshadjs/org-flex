// What can fold (§6) and what each visibility level folds. Works on a Text and
// its OrgStructure, without an editor.

import { Text } from "@codemirror/state";
import { OrgStructure } from "./syntax";

export type VisibilityLevel = "foldall" | "outline" | "expandall";

export const VISIBILITY_ORDER: VisibilityLevel[] = ["foldall", "outline", "expandall"];

export function nextVisibility(level: VisibilityLevel): VisibilityLevel {
  return VISIBILITY_ORDER[(VISIBILITY_ORDER.indexOf(level) + 1) % VISIBILITY_ORDER.length];
}

export interface FoldOptions {
  /** 0-based line of a drawer that must not fold (the front matter drawer, FOLD-7) */
  lockedDrawer: number | null;
}

/** [from, to) of a fold, as document offsets. */
export interface FoldRange {
  from: number;
  to: number;
}

/**
 * The fold for heading line `n` (0-based), ending at line `stop` (exclusive):
 * from the end of the heading line to the end of the last non-blank line
 * before `stop`. Null when there is nothing under the heading.
 */
function foldUntil(doc: Text, n: number, stop: number): FoldRange | null {
  let last = stop - 1;
  while (last > n && !doc.line(last + 1).text.trim()) last--;
  if (last <= n) return null;
  return { from: doc.line(n + 1).to, to: doc.line(last + 1).to };
}

/** Next heading after line `n` with level <= `level`, or the line count. */
export function subtreeEnd(structure: OrgStructure, n: number, level: number): number {
  for (const h of structure.headings) {
    if (h > n && structure.lines[h].level <= level) return h;
  }
  return structure.lines.length;
}

/** FOLD-1, FOLD-2: the fold starting on line `n` (0-based), if any. */
export function foldAt(doc: Text, structure: OrgStructure, n: number, options: FoldOptions): FoldRange | null {
  const info = structure.lines[n];
  if (!info) return null;
  if (info.kind === "heading") {
    return foldUntil(doc, n, subtreeEnd(structure, n, info.level));
  }
  if (info.kind === "drawer-begin") {
    if (options.lockedDrawer === n) return null;
    const drawer = structure.drawers[info.drawer];
    return { from: doc.line(n + 1).to, to: doc.line(drawer.end + 1).to };
  }
  if (info.kind === "block-begin") {
    const block = structure.blocks[info.block];
    return { from: doc.line(n + 1).to, to: doc.line(block.end + 1).to };
  }
  return null;
}

/** FOLD-4: the folds that make up a visibility level. */
export function visibilityFolds(
  doc: Text,
  structure: OrgStructure,
  level: VisibilityLevel,
  foldDrawers: boolean,
  options: FoldOptions,
): FoldRange[] {
  const folds: FoldRange[] = [];
  if (level === "foldall") {
    for (const h of structure.headings) {
      if (structure.lines[h].level !== 1) continue;
      const range = foldAt(doc, structure, h, options);
      if (range) folds.push(range);
    }
  } else if (level === "outline") {
    for (let i = 0; i < structure.headings.length; i++) {
      const h = structure.headings[i];
      const next = i + 1 < structure.headings.length ? structure.headings[i + 1] : structure.lines.length;
      const range = foldUntil(doc, h, next);
      if (range) folds.push(range);
    }
  }
  if (foldDrawers) {
    for (const drawer of structure.drawers) {
      // drawers inside folded headings fold too, so they stay folded when those open
      if (drawer.name !== "PROPERTIES" || drawer.begin === options.lockedDrawer) continue;
      const range = foldAt(doc, structure, drawer.begin, options);
      if (range) folds.push(range);
    }
  }
  return folds.sort((a, b) => a.from - b.from);
}
