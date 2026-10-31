// Org tables (§4a): finding them, reading their rows and cells, writing them
// back aligned the way Org's `org-table-align` does, and the row and column
// operations the grid offers. Pure: works on lines, so it is tested directly.

import { findLinks, OrgStructure, parseInline, walkInline } from "./syntax";

/** TBL-1: a table line starts with `|` after any indentation */
export const TABLE_LINE_RE = /^[ \t]*\|/;
const HLINE_RE = /^[ \t]*\|-/;

export interface TableRow {
  /** a `|---+---|` separator line */
  hline: boolean;
  /** the cells, trimmed; empty for a separator */
  cells: string[];
}

export interface OrgTable {
  /** 0-based first and last line */
  begin: number;
  end: number;
  /** the first line's indentation, kept for every row */
  indent: string;
  rows: TableRow[];
}

/** TBL-1: one table line as a row. */
export function parseRow(text: string): TableRow {
  if (HLINE_RE.test(text)) return { hline: true, cells: [] };
  let body = text.replace(/^[ \t]*\|/, "");
  if (/\|[ \t]*$/.test(body)) body = body.replace(/\|[ \t]*$/, "");
  return { hline: false, cells: body.split("|").map((c) => c.trim()) };
}

/** TBL-1: every table: runs of table lines that are plain text (not in a block or drawer). */
export function findTables(lines: string[], structure: OrgStructure): OrgTable[] {
  const tables: OrgTable[] = [];
  let n = 0;
  while (n < lines.length) {
    if (structure.lines[n]?.kind !== "text" || !TABLE_LINE_RE.test(lines[n])) {
      n++;
      continue;
    }
    const begin = n;
    while (n < lines.length && structure.lines[n]?.kind === "text" && TABLE_LINE_RE.test(lines[n])) n++;
    const slice = lines.slice(begin, n);
    tables.push({ begin, end: n - 1, indent: /^[ \t]*/.exec(slice[0])![0], rows: slice.map(parseRow) });
  }
  return tables;
}

/** The number of columns: the widest row's. */
export function columnCount(rows: TableRow[]): number {
  return Math.max(1, ...rows.map((r) => r.cells.length));
}

// Wide (East Asian, emoji) characters take two columns, combining marks none, as Emacs' string-width counts them.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;
const ZERO = /[̀-ͯ​-‏︀-️]/;

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1;
  return width;
}

/**
 * TBL-3: how wide a cell shows in Emacs: a link counts as its description (or
 * its target), as Org aligns it; with `hideMarkers` (`org-hide-emphasis-markers`)
 * the markers of bold, italic, code and the rest don't count either.
 */
export function cellWidth(cell: string, hideMarkers = false): number {
  let width = 0;
  if (hideMarkers) for (const node of walkInline(parseInline(cell))) if (node.type !== "link") width -= 2;
  let at = 0;
  for (const link of findLinks(cell)) {
    if (link.style !== "regular") continue;
    width += textWidth(cell.slice(at, link.from)) + textWidth(link.description ?? link.target);
    at = link.to;
  }
  return width + textWidth(cell.slice(at));
}

/** Org's `org-table-number-regexp` (its first, common forms) */
const NUMBER_RE = /^(?:[<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|[<>]?[-+]?0[xX][0-9a-fA-F.]+|nan|[-+u]?inf)$/;

/** TBL-3: whether a column is right-aligned: more than half its non-empty cells are numbers (`org-table-number-fraction`). */
export function numericColumn(rows: TableRow[], col: number): boolean {
  let numbers = 0;
  let filled = 0;
  for (const row of rows) {
    const cell = row.cells[col] ?? "";
    if (row.hline || !cell) continue;
    filled++;
    if (NUMBER_RE.test(cell)) numbers++;
  }
  return filled > 0 && numbers / filled > 0.5;
}

/**
 * TBL-3: the table's lines, aligned as `org-table-align` writes them: every
 * row as wide as the widest, each column padded to its widest cell (at least
 * 1), numbers on the right, separators `|---+---|`, all at `indent`.
 */
const cellWidthOf = (cell: string, hide: boolean) => cellWidth(cell, hide);

export function formatTable(rows: TableRow[], indent = "", hideMarkers = false): string[] {
  const cellWidth = (cell: string) => cellWidthOf(cell, hideMarkers);
  const cols = columnCount(rows);
  const widths: number[] = [];
  const right: boolean[] = [];
  for (let c = 0; c < cols; c++) {
    widths.push(Math.max(1, ...rows.map((r) => (r.hline ? 0 : cellWidth(r.cells[c] ?? "")))));
    right.push(numericColumn(rows, c));
  }
  return rows.map((row) => {
    if (row.hline) return `${indent}|${widths.map((w) => "-".repeat(w + 2)).join("+")}|`;
    const cells = widths.map((w, c) => {
      const cell = row.cells[c] ?? "";
      const pad = " ".repeat(w - cellWidth(cell));
      return right[c] ? pad + cell : cell + pad;
    });
    return `${indent}| ${cells.join(" | ")} |`;
  });
}

/** TBL-4: what is typed into a cell, made safe for one: on one line, a `|` written `\vert{}` as Org reads it. */
export function cleanCell(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").replace(/\|/g, "\\vert{}").trim();
}

/** A copy of the rows, every data row filled out to the full width. */
function filled(rows: TableRow[]): TableRow[] {
  const cols = columnCount(rows);
  return rows.map((r) => (r.hline ? { hline: true, cells: [] } : { hline: false, cells: Array.from({ length: cols }, (_, c) => r.cells[c] ?? "") }));
}

/** A cell: the index of its row (separators count) and its column. */
export interface CellAt {
  row: number;
  col: number;
}

export type TableOp =
  | "row-above" | "row-below" | "row-delete" | "row-up" | "row-down"
  | "col-left" | "col-right" | "col-delete" | "col-move-left" | "col-move-right";

/**
 * TBL-5: the rows after `op` at the cell `at`, and the cell to edit next (the
 * new row or column, or the one that moved). Null when it can't be done: the
 * last data row or column can't be deleted, nothing moves past the edge.
 */
export function tableOp(rows: TableRow[], at: CellAt, op: TableOp): { rows: TableRow[]; at: CellAt } | null {
  const out = filled(rows);
  const cols = columnCount(rows);
  const blank = (): TableRow => ({ hline: false, cells: Array.from({ length: cols }, () => "") });
  const { row, col } = at;
  switch (op) {
    case "row-above":
      out.splice(row, 0, blank());
      return { rows: out, at: { row, col } };
    case "row-below":
      out.splice(row + 1, 0, blank());
      return { rows: out, at: { row: row + 1, col } };
    case "row-delete": {
      if (out.filter((r) => !r.hline).length <= 1) return null;
      out.splice(row, 1);
      const next = nearestDataRow(out, Math.min(row, out.length - 1));
      return { rows: out, at: { row: next, col } };
    }
    case "row-up":
    case "row-down": {
      const to = row + (op === "row-up" ? -1 : 1);
      if (to < 0 || to >= out.length) return null;
      [out[row], out[to]] = [out[to], out[row]];
      return { rows: out, at: { row: to, col } };
    }
    case "col-left":
    case "col-right": {
      const c = op === "col-left" ? col : col + 1;
      for (const r of out) if (!r.hline) r.cells.splice(c, 0, "");
      return { rows: out, at: { row, col: c } };
    }
    case "col-delete":
      if (cols <= 1) return null;
      for (const r of out) if (!r.hline) r.cells.splice(col, 1);
      return { rows: out, at: { row, col: Math.min(col, cols - 2) } };
    case "col-move-left":
    case "col-move-right": {
      const to = col + (op === "col-move-left" ? -1 : 1);
      if (to < 0 || to >= cols) return null;
      for (const r of out) if (!r.hline) [r.cells[col], r.cells[to]] = [r.cells[to], r.cells[col]];
      return { rows: out, at: { row, col: to } };
    }
  }
}

function nearestDataRow(rows: TableRow[], from: number): number {
  for (let d = 0; d < rows.length; d++) {
    if (rows[from + d] && !rows[from + d].hline) return from + d;
    if (rows[from - d] && !rows[from - d].hline) return from - d;
  }
  return 0;
}

/**
 * TBL-4: where Tab (`next`), Shift+Tab (`prev`) and Enter (`down`) go from
 * `at`, skipping separators, as Org's TAB and RET do: past the last cell, or
 * below the last row, a new row is added (`rows` then has it).
 */
export function moveCell(rows: TableRow[], at: CellAt, dir: "next" | "prev" | "down"): { rows: TableRow[]; at: CellAt } {
  const cols = columnCount(rows);
  const data = rows.map((r, i) => (r.hline ? -1 : i)).filter((i) => i >= 0);
  const k = data.indexOf(at.row);
  if (dir === "prev") {
    if (at.col > 0) return { rows, at: { row: at.row, col: at.col - 1 } };
    return k > 0 ? { rows, at: { row: data[k - 1], col: cols - 1 } } : { rows, at };
  }
  if (dir === "next" && at.col < cols - 1) return { rows, at: { row: at.row, col: at.col + 1 } };
  const col = dir === "next" ? 0 : at.col;
  if (k >= 0 && k < data.length - 1) {
    // Enter goes to the next data row; Tab too, but a separator between them is crossed
    return { rows, at: { row: data[k + 1], col } };
  }
  const out = filled(rows);
  out.push({ hline: false, cells: Array.from({ length: cols }, () => "") });
  return { rows: out, at: { row: out.length - 1, col } };
}

/** TBL-2: the rows above the first separator are the header, when data rows follow it. */
export function headerRows(rows: TableRow[]): number {
  const first = rows.findIndex((r) => r.hline);
  if (first <= 0) return 0;
  return rows.slice(first).some((r) => !r.hline) && !rows.slice(0, first).some((r) => r.hline) ? first : 0;
}

/** TBL-6: a new table: an empty header row of two columns, a separator and one empty row. */
export const NEW_TABLE = formatTable([
  { hline: false, cells: ["", ""] },
  { hline: true, cells: [] },
  { hline: false, cells: ["", ""] },
]);

/** TBL-7: the offset in the row's line where cell `col` starts (after `| `), for editing it as text. */
export function cellOffset(line: string, col: number): number {
  let at = line.indexOf("|");
  for (let c = 0; c < col; c++) {
    const next = line.indexOf("|", at + 1);
    if (next < 0) break;
    at = next;
  }
  return Math.min(line.length, at + (line[at + 1] === " " ? 2 : 1));
}
