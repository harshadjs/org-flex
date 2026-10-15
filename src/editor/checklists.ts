// Checkboxes in the editor (§8): rendered as Obsidian task checkboxes, toggled
// with a tap, and Enter continuing a list.

import { Prec, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { BoxState, parseItem } from "../org/lists";
import { continueList, toggleBoxOnLine } from "../org/edit";
import { onTap, structureOf } from "./state";

class CheckboxWidget extends WidgetType {
  constructor(readonly state: BoxState) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.state === this.state;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "task-list-item-checkbox org-checkbox";
    box.checked = this.state === "x";
    box.indeterminate = this.state === "-";
    box.setAttribute("data-task", this.state);
    box.setAttribute("aria-label", "Toggle checkbox");
    onTap(box, () => {
      const pos = view.posAtDOM(box);
      const spec = toggleBoxOnLine(view.state, view.state.doc.lineAt(pos).number - 1);
      if (spec) view.dispatch(spec);
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

const doneMark = Decoration.mark({ class: "org-checkbox-done" });
const widgets: Record<BoxState, Decoration> = {
  " ": Decoration.replace({ widget: new CheckboxWidget(" ") }),
  x: Decoration.replace({ widget: new CheckboxWidget("x") }),
  "-": Decoration.replace({ widget: new CheckboxWidget("-") }),
};

function build(view: EditorView): DecorationSet {
  const state = view.state;
  const structure = structureOf(state);
  const head = state.selection.main.head;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (structure.lines[line.number - 1]?.kind === "text") {
        const item = parseItem(line.text);
        if (item?.box) {
          const boxFrom = line.from + item.box.from;
          const boxTo = line.from + item.box.to;
          // the raw "[ ]" shows while the cursor is strictly inside it
          if (!(head > boxFrom && head < boxTo)) out.push(widgets[item.box.state].range(boxFrom, boxTo));
          if (item.box.state === "x" && line.from + item.textFrom < line.to) {
            out.push(doneMark.range(line.from + item.textFrom, line.to));
          }
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

const checkboxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const enterKey = Prec.high(keymap.of([{
  key: "Enter",
  run(view) {
    const spec = continueList(view.state);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  },
}]));

export function checklists() {
  return [checkboxPlugin, enterKey];
}
