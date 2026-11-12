// The shortcut bar (§9.1): a panel below the editor, so on phones it sits
// just above the keyboard; one row that scrolls sideways. The top row has a
// few buttons and a button per group; tapping a group swaps the row for the
// group's buttons, with a back button (BAR-12). Tapping a button never takes
// focus from the editor; editing buttons give it back if the editor had it.

import { EditorView, Panel, showPanel, ViewUpdate } from "@codemirror/view";
import { redoDepth, undoDepth } from "@codemirror/commands";
import type { BarItem, ButtonDef, GroupId } from "../settings";
import type { MarkupType } from "../org/syntax";
import { VisibilityLevel } from "../org/folding";
import { activeMarkup } from "../org/markup";
import { visibilityField } from "./folding";
import { zoomField } from "./zoom";
import { onTap } from "./state";

export const VISIBILITY_ICONS: Record<VisibilityLevel, string> = {
  foldall: "fold-vertical",
  outline: "list-tree",
  expandall: "unfold-vertical",
};

export const VISIBILITY_LABELS: Record<VisibilityLevel, string> = {
  foldall: "Visibility: fold all",
  outline: "Visibility: outline",
  expandall: "Visibility: expand all",
};

/** ACT-17: the format buttons and the emphasis each toggles */
export const FORMAT_BUTTONS: Partial<Record<ButtonDef["id"], MarkupType>> = {
  bold: "bold", italic: "italic", code: "code", verbatim: "verbatim", strike: "strikethrough", underline: "underline",
};

export interface BarOptions {
  /** the top row (BAR-2, BAR-12) */
  items: BarItem[];
  setIcon(el: HTMLElement, icon: string): void;
  run(id: ButtonDef["id"], view: EditorView): void;
  /** BAR-11: what holding a button does, for the buttons that have a long press */
  long?(id: ButtonDef["id"]): (() => void) | undefined;
}

class Bar implements Panel {
  dom: HTMLElement;
  top = false;
  private elements = new Map<string, HTMLElement>();
  private level: VisibilityLevel | null = null;
  /** BAR-12: the open group, or null for the top row */
  private group: GroupId | null = null;

  constructor(private view: EditorView, private options: BarOptions) {
    this.dom = document.createElement("div");
    this.dom.className = "org-shortcut-bar";
    this.draw();
  }

  /** BAR-12: show the top row, or the open group's row with a back button first */
  private draw() {
    this.dom.textContent = "";
    this.elements.clear();
    this.level = null;
    const open = this.options.items.find((i): i is Extract<BarItem, { kind: "group" }> => i.kind === "group" && i.group.id === this.group);
    this.dom.classList.toggle("is-group", !!open);
    if (open) {
      this.dom.setAttribute("data-group", open.group.id);
      const back = this.addButton("Back", "arrow-left", "back");
      back.classList.add("org-shortcut-back");
      onTap(back, () => this.show(null));
      for (const def of open.defs) this.addDef(def, open.group.stays);
    } else {
      this.dom.removeAttribute("data-group");
      for (const item of this.options.items) {
        if (item.kind === "button") this.addDef(item.def, true);
        else {
          const button = this.addButton(item.group.name, item.group.icon, null);
          button.classList.add("org-shortcut-group");
          button.setAttribute("data-group", item.group.id);
          onTap(button, () => this.show(item.group.id));
        }
      }
    }
    this.refresh();
  }

  private show(group: GroupId | null) {
    this.group = group;
    this.draw();
    this.dom.scrollLeft = 0;
  }

  private addButton(label: string, icon: string, id: string | null): HTMLElement {
    const button = this.dom.appendChild(document.createElement("button"));
    button.className = "org-shortcut-button clickable-icon";
    button.setAttribute("aria-label", label);
    if (id) button.setAttribute("data-button", id);
    this.options.setIcon(button, icon);
    return button;
  }

  private addDef(def: ButtonDef, stay: boolean) {
    const button = this.addButton(def.name, def.icon, def.id);
    onTap(button, () => {
      const hadFocus = this.view.hasFocus;
      this.options.run(def.id, this.view);
      if (def.refocus === "always" || (def.refocus && hadFocus)) this.view.focus();
      // BAR-12: a group goes back to the top row after its button, except one that stays (Format)
      if (!stay) this.show(null);
    }, this.options.long?.(def.id));
    this.elements.set(def.id, button);
  }

  update(update: ViewUpdate) {
    if (update.transactions.length || update.selectionSet) this.refresh();
  }

  private refresh() {
    const state = this.view.state;
    this.elements.get("undo")?.classList.toggle("is-disabled", undoDepth(state) === 0);
    this.elements.get("redo")?.classList.toggle("is-disabled", redoDepth(state) === 0);
    this.elements.get("zoom")?.classList.toggle("is-active", Boolean(state.field(zoomField, false)));
    if (this.group === "format") {
      // ACT-17: a format the cursor is in shows as on
      const active = activeMarkup(state);
      for (const [id, type] of Object.entries(FORMAT_BUTTONS)) {
        const el = this.elements.get(id);
        if (!el) continue;
        el.classList.toggle("is-active", active.has(type!));
        el.setAttribute("aria-pressed", String(active.has(type!)));
      }
    }
    const visibility = this.elements.get("visibility");
    const level = state.field(visibilityField, false) ?? "expandall";
    if (visibility && level !== this.level) {
      this.level = level;
      this.options.setIcon(visibility, VISIBILITY_ICONS[level]);
      visibility.setAttribute("aria-label", VISIBILITY_LABELS[level]);
    }
  }
}

export function shortcutBar(options: BarOptions) {
  return showPanel.of((view) => new Bar(view, options));
}
