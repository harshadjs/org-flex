// Zoom (§7a): show one heading and its subtree, like Org's
// org-narrow-to-subtree. Pure: line numbers and offsets only.

import { Text } from "@codemirror/state";
import { subtreeEnd } from "./folding";
import { Keywords, OrgStructure } from "./syntax";
import { headingTitle } from "./vault-index";

/** [from, to] of the zoomed text: the heading line's start to the end of its subtree's last line. */
export interface ZoomRange {
  from: number;
  to: number;
}

/** The heading (0-based line) that line `n` is under, or null before the first heading. */
export function headingAbove(structure: OrgStructure, n: number): number | null {
  let found: number | null = null;
  for (const h of structure.headings) {
    if (h > n) break;
    found = h;
  }
  return found;
}

/** ZOOM-1: the subtree of heading line `h` (0-based). */
export function subtreeRange(doc: Text, structure: OrgStructure, h: number): ZoomRange {
  const end = subtreeEnd(structure, h, structure.lines[h].level);
  return { from: doc.line(h + 1).from, to: doc.line(end).to };
}

/** ZOOM-1: the parts outside the zoom, as whole lines (the line breaks next to the zoom stay). */
export function hiddenRanges(doc: Text, zoom: ZoomRange): ZoomRange[] {
  const hidden: ZoomRange[] = [];
  if (zoom.from > 0) hidden.push({ from: 0, to: zoom.from - 1 });
  if (zoom.to < doc.length) hidden.push({ from: zoom.to + 1, to: doc.length });
  return hidden;
}

export interface Crumb {
  /** 0-based heading line */
  line: number;
  title: string;
}

/** ZOOM-2: the headings from the top level down to heading line `h`, by title. */
export function crumbs(doc: Text, structure: OrgStructure, h: number, keywords: Keywords): Crumb[] {
  const path: Crumb[] = [];
  let level = structure.lines[h].level + 1;
  for (let n = h; n >= 0; n--) {
    const info = structure.lines[n];
    if (info.kind === "heading" && info.level < level) {
      level = info.level;
      path.unshift({ line: n, title: headingTitle(doc.line(n + 1).text, keywords) });
      if (level === 1) break;
    }
  }
  return path;
}
