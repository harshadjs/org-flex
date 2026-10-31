import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { analyze } from "../src/org/syntax";
import {
  cellOffset, cellWidth, cleanCell, findTables, formatTable, headerRows, moveCell, NEW_TABLE, parseRow, tableOp, TableRow,
} from "../src/org/table";
import { insertTable } from "../src/org/edit";

const rows = (...lines: string[]): TableRow[] => lines.map(parseRow);
const cells = (rs: TableRow[]) => rs.map((r) => (r.hline ? "-" : r.cells.join(",")));

describe("tables", () => {
  test("tables are runs of bar-started lines outside blocks and drawers, with rows, separators and cells", () => {
    const lines = [
      "* H", "| a | b |", "|---+---|", "  | 1 | 2", "text", "#+begin_example", "| not | a table |", "#+end_example",
      ":NOTES:", "| nor | this |", ":END:", "- | a list item | isn't one",
    ];
    const tables = findTables(lines, analyze(lines));
    expect(tables.map((t) => [t.begin, t.end, t.indent])).toEqual([[1, 3, ""]]);
    expect(tables[0].rows).toEqual([
      { hline: false, cells: ["a", "b"] },
      { hline: true, cells: [] },
      // the last | is optional
      { hline: false, cells: ["1", "2"] },
    ]);
    expect(parseRow("|  | x |").cells).toEqual(["", "x"]);
    expect(parseRow("|-").hline).toBe(true);
  });

  test("a table is written back aligned as Org does: padded columns, numbers right, links by their description", () => {
    expect(formatTable(rows("| Name | Qty |", "|-", "| apple | 3", "| [[id:x][fig]] | 12 |", "| 日本 |"), "  ")).toEqual([
      "  | Name  | Qty |",
      "  |-------+-----|",
      "  | apple |   3 |",
      // as wide as it shows: "fig"
      "  | [[id:x][fig]]   |  12 |",
      "  | 日本  |     |",
    ]);
    expect(cellWidth("[[id:x][fig]]")).toBe(3);
    expect(cellWidth("see [[https://example.com]]")).toBe(4 + 19);
    expect(cellWidth("日本")).toBe(4);
    // with org-hide-emphasis-markers, as Emacs shows them: "bold and code" and "x"
    expect(cellWidth("*bold* and ~code~", true)).toBe(13);
    expect(cellWidth("[[id:y][*x*]]", true)).toBe(3);
    expect(formatTable(rows("| *a* |", "| bb |"), "", true)).toEqual(["| *a*  |", "| bb |"]);
    // empty columns are one wide; half numbers is not enough to go right
    expect(formatTable(rows("| | x |", "| 1 | y |"))).toEqual(["|   | x |", "| 1 | y |"]);
    expect(formatTable(rows("| a |", "| 1 |"))).toEqual(["| a |", "| 1 |"]);
    expect(NEW_TABLE).toEqual(["|   |   |", "|---+---|", "|   |   |"]);
  });

  test("what is typed into a cell stays one cell on one line", () => {
    expect(cleanCell("  a | b\nc ")).toBe("a \\vert{} b c");
    expect(cellOffset("  | ab | cd |", 0)).toBe(4);
    expect(cellOffset("  | ab | cd |", 1)).toBe(9);
    expect(cellOffset("|x|y", 1)).toBe(3);
  });

  test("Tab, Shift+Tab and Enter move between cells, skipping separators, adding a row past the end", () => {
    const t = rows("| a | b |", "|-", "| c | d |");
    expect(moveCell(t, { row: 0, col: 0 }, "next").at).toEqual({ row: 0, col: 1 });
    expect(moveCell(t, { row: 0, col: 1 }, "next").at).toEqual({ row: 2, col: 0 });
    expect(moveCell(t, { row: 2, col: 0 }, "prev").at).toEqual({ row: 0, col: 1 });
    expect(moveCell(t, { row: 0, col: 0 }, "prev")).toEqual({ rows: t, at: { row: 0, col: 0 } });
    expect(moveCell(t, { row: 0, col: 1 }, "down")).toEqual({ rows: t, at: { row: 2, col: 1 } });
    const past = moveCell(t, { row: 2, col: 1 }, "next");
    expect(past.at).toEqual({ row: 3, col: 0 });
    expect(cells(past.rows)).toEqual(["a,b", "-", "c,d", ","]);
    expect(moveCell(t, { row: 2, col: 1 }, "down").at).toEqual({ row: 3, col: 1 });
  });

  test("rows and columns are added, deleted and moved; the last row or column stays", () => {
    const t = rows("| a | b |", "|-", "| c | d |");
    const at = { row: 2, col: 0 };
    expect(cells(tableOp(t, at, "row-above")!.rows)).toEqual(["a,b", "-", ",", "c,d"]);
    expect(tableOp(t, at, "row-below")!.at).toEqual({ row: 3, col: 0 });
    expect(cells(tableOp(t, at, "row-delete")!.rows)).toEqual(["a,b", "-"]);
    expect(tableOp(t, at, "row-delete")!.at).toEqual({ row: 0, col: 0 });
    // moving a row crosses a separator, as Org's M-up does
    expect(cells(tableOp(t, at, "row-up")!.rows)).toEqual(["a,b", "c,d", "-"]);
    expect(tableOp(t, at, "row-down")).toBeNull();
    expect(cells(tableOp(t, { row: 0, col: 1 }, "col-left")!.rows)).toEqual(["a,,b", "-", "c,,d"]);
    expect(tableOp(t, { row: 0, col: 1 }, "col-right")!.at).toEqual({ row: 0, col: 2 });
    expect(cells(tableOp(t, { row: 0, col: 1 }, "col-delete")!.rows)).toEqual(["a", "-", "c"]);
    expect(cells(tableOp(t, { row: 0, col: 0 }, "col-move-right")!.rows)).toEqual(["b,a", "-", "d,c"]);
    expect(tableOp(t, { row: 0, col: 0 }, "col-move-left")).toBeNull();
    expect(tableOp(rows("| a |"), { row: 0, col: 0 }, "col-delete")).toBeNull();
    expect(tableOp(rows("| a |", "|-"), { row: 0, col: 0 }, "row-delete")).toBeNull();
    // short rows are filled out to the full width
    expect(cells(tableOp(rows("| a | b |", "| c"), { row: 0, col: 0 }, "row-below")!.rows)).toEqual(["a,b", ",", "c,"]);
  });

  test("the header is the rows above the first separator, when rows follow it", () => {
    expect(headerRows(rows("| a |", "| b |", "|-", "| c |"))).toBe(2);
    expect(headerRows(rows("| a |", "|-"))).toBe(0);
    expect(headerRows(rows("|-", "| a |"))).toBe(0);
    expect(headerRows(rows("| a |", "| b |"))).toBe(0);
  });

  test("insertTable turns a blank line into a table, or puts it below the line, the cursor outside it", () => {
    const blank = EditorState.create({ doc: "* H\n\nafter", selection: EditorSelection.cursor(4) });
    const a = insertTable(blank);
    const s1 = blank.update(a.spec).state;
    expect(s1.doc.toString()).toBe(`* H\n${NEW_TABLE.join("\n")}\nafter`);
    expect(a.line).toBe(1);
    expect(s1.selection.main.head).toBe(4);
    const text = EditorState.create({ doc: "* H\nbody", selection: EditorSelection.cursor(5) });
    const b = insertTable(text);
    const s2 = text.update(b.spec).state;
    expect(s2.doc.toString()).toBe(`* H\nbody\n${NEW_TABLE.join("\n")}`);
    expect(b.line).toBe(2);
    expect(s2.selection.main.head).toBe(8);
  });
});
