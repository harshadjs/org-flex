// The front matter panel (§7): the drawer and keyword lines at the top of the
// file are replaced by a title and a Properties list, until the user moves
// into them.

import { EditorSelection, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { displayValue, FrontMatter, propertyIcon, simplifyValue } from "../org/front-matter";
import { docInfo, onTap, orgConfig, orgHost } from "./state";

export const revealFrontMatter = StateEffect.define<boolean>();
export const toggleProperties = StateEffect.define<null>();

interface PanelState {
  revealed: boolean;
  collapsed: boolean;
}

function frontMatterEnd(state: EditorState, fm: FrontMatter): number {
  return state.doc.line(fm.endLine + 1).to;
}

function movedInto(tr: Transaction): boolean {
  return tr.isUserEvent("select") || tr.isUserEvent("input") || tr.isUserEvent("delete") ||
    tr.isUserEvent("move") || tr.isUserEvent("undo") || tr.isUserEvent("redo");
}

export const panelState = StateField.define<PanelState>({
  create: (state) => ({ revealed: false, collapsed: state.facet(orgConfig).foldPropertyDrawers }),
  update(value, tr) {
    let { revealed, collapsed } = value;
    for (const e of tr.effects) {
      if (e.is(revealFrontMatter)) revealed = e.value;
      if (e.is(toggleProperties)) collapsed = !collapsed;
    }
    const fm = tr.state.field(docInfo).frontMatter;
    if (!fm) {
      revealed = false;
    } else if ((tr.selection || tr.docChanged) && !tr.effects.some((e) => e.is(revealFrontMatter))) {
      const inside = tr.state.selection.main.head <= frontMatterEnd(tr.state, fm);
      if (!inside) revealed = false;
      else if (movedInto(tr)) revealed = true;
    }
    return revealed === value.revealed && collapsed === value.collapsed ? value : { revealed, collapsed };
  },
});

interface Row {
  key: string;
  value: string;
  line: number;
}

interface PanelData {
  title: { text: string; line: number } | null;
  rows: Row[];
  collapsed: boolean;
}

class PanelWidget extends WidgetType {
  private key: string;
  constructor(readonly data: PanelData) {
    super();
    this.key = JSON.stringify(data);
  }
  eq(other: PanelWidget) {
    return other.key === this.key;
  }
  ignoreEvent() {
    return true;
  }

  toDOM(view: EditorView) {
    const host = view.state.facet(orgHost);
    const icon = (el: HTMLElement, name: string) => host?.setIcon(el, name);
    const editLine = (line: number) => () => {
      const pos = view.state.doc.line(line + 1).to;
      view.dispatch({ selection: EditorSelection.cursor(pos), effects: revealFrontMatter.of(true), scrollIntoView: true });
      view.focus();
    };

    const root = document.createElement("div");
    root.className = "org-front-matter";
    if (this.data.title) {
      const title = root.appendChild(document.createElement("div"));
      title.className = "org-front-matter-title inline-title";
      title.textContent = simplifyValue(this.data.title.text);
      // a click on the title is meant for editing it (FM-5)
      title.addEventListener("click", editLine(this.data.title.line));
    }
    if (!this.data.rows.length) return root;

    const header = root.appendChild(document.createElement("div"));
    header.className = "org-properties-header" + (this.data.collapsed ? " is-collapsed" : "");
    const chevron = header.appendChild(document.createElement("span"));
    chevron.className = "org-properties-chevron";
    icon(chevron, this.data.collapsed ? "chevron-right" : "chevron-down");
    header.appendChild(document.createElement("span")).textContent = "Properties";
    if (this.data.collapsed) {
      const count = header.appendChild(document.createElement("span"));
      count.className = "org-properties-count";
      count.textContent = String(this.data.rows.length);
    }
    onTap(header, () => view.dispatch({ effects: toggleProperties.of(null) }));
    if (this.data.collapsed) return root;

    const list = root.appendChild(document.createElement("div"));
    list.className = "org-properties";
    for (const row of this.data.rows) {
      const el = list.appendChild(document.createElement("div"));
      el.className = "org-property";
      const iconEl = el.appendChild(document.createElement("span"));
      iconEl.className = "org-property-icon";
      icon(iconEl, propertyIcon(row.key, row.value));
      const key = el.appendChild(document.createElement("span"));
      key.className = "org-property-key";
      key.textContent = row.key;
      const value = el.appendChild(document.createElement("span"));
      value.className = "org-property-value";
      const shown = displayValue(row.key, row.value);
      if (shown.kind === "pills") {
        for (const item of shown.items) {
          const pill = value.appendChild(document.createElement("span"));
          pill.className = "org-property-pill";
          pill.textContent = item;
        }
      } else if (shown.kind === "text") {
        value.textContent = shown.text;
      } else {
        value.classList.add("is-empty");
        value.textContent = "Empty";
      }
      el.addEventListener("click", editLine(row.line));
    }
    return root;
  }
}

function decorations(state: EditorState): DecorationSet {
  const fm = state.field(docInfo).frontMatter;
  const panel = state.field(panelState);
  if (!fm || panel.revealed) return Decoration.none;
  const data: PanelData = {
    title: fm.title ? { text: fm.title.value, line: fm.title.line } : null,
    rows: fm.entries.map((e) => ({ key: e.key, value: e.value, line: e.line })),
    collapsed: panel.collapsed,
  };
  return Decoration.set(Decoration.replace({ widget: new PanelWidget(data), block: true }).range(0, frontMatterEnd(state, fm)));
}

const panelDecorations = StateField.define<DecorationSet>({
  create: decorations,
  update(value, tr) {
    if (tr.docChanged || tr.startState.field(panelState) !== tr.state.field(panelState) ||
        tr.startState.field(docInfo) !== tr.state.field(docInfo)) {
      return decorations(tr.state);
    }
    return value;
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

export function frontMatterPanel() {
  return [panelState, panelDecorations];
}
