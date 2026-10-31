// Tables (§4a): each Org table shows as a grid (a block widget over its lines,
// from a state field, as block decorations must be) while the cursor isn't
// inside its text. Tapping a cell edits it in place; Tab, Shift+Tab and Enter
// move on, and every change is written back aligned, as Org writes tables.
// A strip above the grid adds, deletes and moves rows and columns.

import { EditorSelection, EditorState, Range, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { InlineNode, OrgStructure, parseInline } from "../org/syntax";
import {
  CellAt, cellOffset, cleanCell, findTables, formatTable, headerRows, moveCell, numericColumn, OrgTable,
  parseRow, TableOp, tableOp, TableRow,
} from "../org/table";
import { onTap, orgConfig, orgHost, structureOf } from "./state";

const cache = new WeakMap<OrgStructure, OrgTable[]>();

/** TBL-1: the document's tables, worked out once per document version. */
export function tablesOf(state: EditorState): OrgTable[] {
  const structure = structureOf(state);
  let tables = cache.get(structure);
  if (!tables) {
    const lines: string[] = [];
    for (const line of state.doc.iterLines()) lines.push(line);
    cache.set(structure, (tables = findTables(lines, structure)));
  }
  return tables;
}

/** TBL-7: a table shows as text while a cursor (or a selection's end) is inside it, past its first character. */
function cursorInside(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => (r.head > from && r.head < to) || (r.anchor > from && r.anchor < to));
}

function decorations(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (const table of tablesOf(state)) {
    const from = state.doc.line(table.begin + 1).from;
    const to = state.doc.line(table.end + 1).to;
    if (cursorInside(state, from, to)) continue;
    const widget = new TableWidget(state.doc.sliceString(from, to), table.rows.length);
    out.push(Decoration.replace({ widget, block: true }).range(from, to));
  }
  return Decoration.set(out);
}

const tableField = StateField.define<DecorationSet>({
  create: decorations,
  update(value, tr) {
    return tr.docChanged || tr.selection ? decorations(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Each grid's way to start editing one of its cells. */
const editors = new WeakMap<HTMLElement, (at: CellAt) => void>();

/** TBL-6: start editing cell `at` of the table whose first line is `begin` (0-based); false when it isn't on screen. */
export function editTableCell(view: EditorView, begin: number, at: CellAt): boolean {
  if (begin + 1 > view.state.doc.lines) return false;
  const pos = view.state.doc.line(begin + 1).from;
  for (const el of Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".org-table-wrap"))) {
    let p: number;
    try {
      p = view.posAtDOM(el);
    } catch {
      continue;
    }
    if (p !== pos) continue;
    editors.get(el)?.(at);
    return true;
  }
  return false;
}

/** TBL-2: a cell's text with its markup and links, as live preview shows them; `\vert{}` shows as `|`. */
function renderInline(parent: HTMLElement, text: string, from: number, to: number, nodes: InlineNode[]) {
  const plain = (a: number, b: number) => {
    if (b > a) parent.append(text.slice(a, b).replace(/\\vert\{\}/g, "|"));
  };
  let at = from;
  for (const node of nodes) {
    plain(at, node.from);
    if (node.type === "link") {
      const link = parent.appendChild(document.createElement("span"));
      link.className = "org-link";
      link.setAttribute("data-org-link", node.target);
      link.textContent = node.style === "regular" ? node.description ?? node.target : node.target;
    } else {
      const span = parent.appendChild(document.createElement("span"));
      span.className = `org-text-${node.type}`;
      renderInline(span, text, node.from + 1, node.to - 1, node.children);
    }
    at = node.to;
  }
  plain(at, to);
}

const shown = (cell: string) => cell.replace(/\\vert\{\}/g, "|");

/** The strip's buttons: what each does, its icon, its name and a text stand-in for a missing icon. */
const TOOLS: { group: string; items: [TableOp | "text" | "done", string, string, string][] }[] = [
  { group: "Row", items: [
    ["row-above", "between-horizontal-start", "Insert row above", "+↑"],
    ["row-below", "between-horizontal-end", "Insert row below", "+↓"],
    ["row-up", "arrow-up", "Move row up", "↑"],
    ["row-down", "arrow-down", "Move row down", "↓"],
    ["row-delete", "trash-2", "Delete row", "✕"],
  ] },
  { group: "Column", items: [
    ["col-left", "between-vertical-start", "Insert column left", "+←"],
    ["col-right", "between-vertical-end", "Insert column right", "+→"],
    ["col-move-left", "arrow-left", "Move column left", "←"],
    ["col-move-right", "arrow-right", "Move column right", "→"],
    ["col-delete", "trash-2", "Delete column", "✕"],
  ] },
  { group: "", items: [
    ["text", "code", "Edit as text", "</>"],
    ["done", "check", "Done", "✓"],
  ] },
];

class TableWidget extends WidgetType {
  constructor(readonly text: string, readonly rowCount: number) {
    super();
  }

  eq(other: TableWidget) {
    return other.text === this.text;
  }

  get estimatedHeight() {
    return this.rowCount * 32 + 8;
  }

  ignoreEvent() {
    return true;
  }

  toDOM(view: EditorView) {
    const host = view.state.facet(orgHost);
    const rows = this.text.split("\n").map(parseRow);
    const cols = Math.max(1, ...rows.map((r) => r.cells.length));
    const header = headerRows(rows);
    const numeric = Array.from({ length: cols }, (_, c) => numericColumn(rows, c));

    const wrap = document.createElement("div");
    wrap.className = "org-table-wrap";
    const tools = wrap.appendChild(document.createElement("div"));
    tools.className = "org-table-tools";
    const scroller = wrap.appendChild(document.createElement("div"));
    scroller.className = "org-table-scroll";
    const table = scroller.appendChild(document.createElement("table"));
    table.className = "org-table";
    const head = header ? table.appendChild(document.createElement("thead")) : null;
    const body = table.appendChild(document.createElement("tbody"));

    const cellEl = (at: CellAt) => table.querySelector<HTMLElement>(`tr[data-row="${at.row}"] > [data-col="${at.col}"]`);
    const fill = (el: HTMLElement, text: string) => {
      el.textContent = "";
      renderInline(el, text, 0, text.length, parseInline(text));
    };

    let ruled = false;
    rows.forEach((row, r) => {
      if (row.hline) {
        // the separator shows as a rule above the next row
        ruled = r > 0;
        return;
      }
      const tr = (r < header ? head! : body).appendChild(document.createElement("tr"));
      tr.setAttribute("data-row", String(r));
      if (ruled && r > header) tr.classList.add("org-table-rule");
      ruled = false;
      for (let c = 0; c < cols; c++) {
        const td = tr.appendChild(document.createElement(r < header ? "th" : "td"));
        td.setAttribute("data-col", String(c));
        if (numeric[c]) td.classList.add("org-table-num");
        fill(td, row.cells[c] ?? "");
      }
    });

    /** the table as it is in the document now, found by where this grid sits */
    const current = (): { table: OrgTable; from: number; to: number } | null => {
      let pos: number;
      try {
        pos = view.posAtDOM(wrap);
      } catch {
        return null;
      }
      const t = tablesOf(view.state).find((t) => view.state.doc.line(t.begin + 1).from === pos);
      return t ? { table: t, from: pos, to: view.state.doc.line(t.end + 1).to } : null;
    };

    let editing: { at: CellAt; input: HTMLInputElement; original: string; leaving: boolean } | null = null;

    /** stop editing here without writing anything: the cell shows its text again */
    const close = () => {
      if (!editing) return;
      const { at, input } = editing;
      editing.leaving = true;
      editing = null;
      const td = cellEl(at);
      if (td) {
        td.classList.remove("is-editing");
        fill(td, rows[at.row]?.cells[at.col] ?? "");
      }
      wrap.classList.remove("is-editing");
      if (document.activeElement === input) input.blur();
    };

    const start = (at: CellAt) => {
      if (!view.state.facet(EditorView.editable)) return;
      const td = cellEl(at);
      if (!td) return;
      close();
      const cell = rows[at.row]?.cells[at.col] ?? "";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "org-table-input";
      input.value = shown(cell);
      input.setAttribute("enterkeyhint", "next");
      input.setAttribute("aria-label", "Cell");
      td.textContent = "";
      td.appendChild(input);
      td.classList.add("is-editing");
      wrap.classList.add("is-editing");
      editing = { at, input, original: input.value, leaving: false };
      input.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.key === "Tab") {
          e.preventDefault();
          go((rows, at) => moveCell(rows, at, e.shiftKey ? "prev" : "next"));
        } else if (e.key === "Enter") {
          e.preventDefault();
          go((rows, at) => moveCell(rows, at, "down"));
        } else if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      });
      input.addEventListener("blur", () => {
        if (editing?.input === input && !editing.leaving) go(null);
      });
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    };
    editors.set(wrap, start);

    /**
     * TBL-4, TBL-5: write the cell being edited, then do `next` (a move or an
     * operation) and edit the cell it names; with no `next`, stop editing.
     * Nothing is written unless a cell or the shape changed.
     */
    const go = (next: ((rows: TableRow[], at: CellAt) => { rows: TableRow[]; at: CellAt } | null) | null, after?: (begin: number, at: CellAt) => void) => {
      const now = current();
      if (!now || !editing) return;
      const at = editing.at;
      const value = editing.input.value;
      const typed = value !== editing.original;
      let out = now.table.rows.map((r) => ({ hline: r.hline, cells: [...r.cells] }));
      if (typed) {
        while (out[at.row].cells.length <= at.col) out[at.row].cells.push("");
        out[at.row].cells[at.col] = cleanCell(value);
      }
      const result = next ? next(out, at) : null;
      if (next && !result) return;
      const shaped = result !== null && result.rows !== out;
      if (result) out = result.rows;
      const target = result?.at ?? null;
      const begin = now.table.begin;
      if (!typed && !shaped) {
        close();
        if (target) start(target);
        after?.(begin, at);
        return;
      }
      editing.leaving = true;
      const text = formatTable(out, now.table.indent, view.state.facet(orgConfig).hideEmphasisMarkers).join("\n");
      view.dispatch({ changes: { from: now.from, to: now.to, insert: text }, userEvent: "input.table" });
      // the grid was drawn again; carry on in the new one, in the same tap or key press, so the keyboard stays up
      if (target) editTableCell(view, begin, target);
      after?.(begin, target ?? at);
    };

    // TBL-4: taps inside the cell being typed in move its caret, as usual
    const inInput = (e: Event) => (e.target as HTMLElement).closest?.("input") != null;
    onTap(table, (e) => {
      const el = e.target as HTMLElement;
      const link = el.closest?.("[data-org-link]");
      if (link) {
        const target = link.getAttribute("data-org-link");
        if (target) host?.openLink(target, view);
        return;
      }
      const td = el.closest?.("td, th");
      const tr = td?.parentElement;
      if (!td || !tr) return;
      const at = { row: Number(tr.getAttribute("data-row")), col: Number(td.getAttribute("data-col")) };
      if (editing && editing.at.row === at.row && editing.at.col === at.col) return;
      if (editing) go((rows) => ({ rows, at }));
      else start(at);
    }, undefined, inInput);

    for (const { group, items } of TOOLS) {
      const box = tools.appendChild(document.createElement("div"));
      box.className = "org-table-tool-group";
      if (group) box.appendChild(document.createElement("span")).textContent = group;
      for (const [op, icon, name, stand] of items) {
        const button = box.appendChild(document.createElement("button"));
        button.className = "org-table-tool clickable-icon";
        button.setAttribute("aria-label", name);
        button.setAttribute("data-table-op", op);
        host?.setIcon(button, icon);
        if (!button.firstChild) button.textContent = stand;
        onTap(button, () => {
          if (op === "done") go(null);
          else if (op === "text") go(null, (begin, at) => {
            // TBL-7: the cursor goes into the cell's text, which then shows as text
            const line = view.state.doc.line(begin + 1 + at.row);
            view.dispatch({ selection: EditorSelection.cursor(line.from + cellOffset(line.text, at.col)), scrollIntoView: true });
            view.focus();
          });
          else go((rows, at) => tableOp(rows, at, op));
        });
      }
    }
    return wrap;
  }
}

export function orgTables() {
  return [tableField];
}
