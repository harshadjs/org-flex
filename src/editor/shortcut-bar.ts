// The shortcut bar (§9.1): a panel below the editor, so on phones it sits
// just above the keyboard; one row that scrolls sideways. Tapping a button never takes focus from the editor; editing
// buttons give it back if the editor had it.

import { EditorView, Panel, showPanel, ViewUpdate } from "@codemirror/view";
import { redoDepth, undoDepth } from "@codemirror/commands";
import { ButtonDef } from "../settings";
import { VisibilityLevel } from "../org/folding";
import { visibilityField } from "./folding";
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

export interface BarOptions {
  /** the buttons to show, in bar order */
  buttons: ButtonDef[];
  /** the icon for a button (custom or default) */
  icon(def: ButtonDef): string;
  setIcon(el: HTMLElement, icon: string): void;
  run(id: ButtonDef["id"], view: EditorView): void;
}

class Bar implements Panel {
  dom: HTMLElement;
  top = false;
  private elements = new Map<string, HTMLElement>();
  private level: VisibilityLevel | null = null;

  constructor(private view: EditorView, private options: BarOptions) {
    this.dom = document.createElement("div");
    this.dom.className = "org-shortcut-bar";
    for (const def of options.buttons) {
      const button = this.dom.appendChild(document.createElement("button"));
      button.className = "org-shortcut-button clickable-icon";
      button.setAttribute("aria-label", def.name);
      button.setAttribute("data-button", def.id);
      options.setIcon(button, options.icon(def));
      onTap(button, () => {
        const hadFocus = view.hasFocus;
        options.run(def.id, view);
        if (def.refocus && hadFocus) view.focus();
      });
      this.elements.set(def.id, button);
    }
    this.refresh();
  }

  update(update: ViewUpdate) {
    if (update.transactions.length) this.refresh();
  }

  private refresh() {
    const state = this.view.state;
    this.elements.get("undo")?.classList.toggle("is-disabled", undoDepth(state) === 0);
    this.elements.get("redo")?.classList.toggle("is-disabled", redoDepth(state) === 0);
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
