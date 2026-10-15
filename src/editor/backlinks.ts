// The backlinks section (§5a) at the end of the document: "Linked mentions"
// and "Unlinked mentions". The view computes the data from the vault index
// and sends it in with setBacklinks.

import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { Backlink, Mention } from "../org/vault-index";
import { onTap, orgHost } from "./state";

export interface BacklinksData {
  backlinks: Backlink[];
  /** null while the unlinked section is closed: it isn't computed then */
  mentions: Mention[] | null;
  linkedOpen: boolean;
  mentionsOpen: boolean;
}

export interface BacklinksActions {
  open(path: string, line: number): void;
  link(mention: Mention): void;
  toggle(section: "linked" | "mentions"): void;
}

export const setBacklinks = StateEffect.define<BacklinksData | null>();

class BacklinksWidget extends WidgetType {
  private key: string;
  constructor(readonly data: BacklinksData, readonly actions: BacklinksActions) {
    super();
    this.key = JSON.stringify(data);
  }
  eq(other: BacklinksWidget) {
    return other.key === this.key;
  }
  ignoreEvent() {
    return true;
  }

  private header(view: EditorView, root: HTMLElement, id: "linked" | "mentions", label: string, count: number | null, open: boolean) {
    const header = root.appendChild(document.createElement("div"));
    header.className = "org-backlinks-header";
    const chevron = header.appendChild(document.createElement("span"));
    chevron.className = "org-backlinks-chevron";
    view.state.facet(orgHost)?.setIcon(chevron, open ? "chevron-down" : "chevron-right");
    header.appendChild(document.createElement("span")).textContent = label;
    if (count !== null) {
      const c = header.appendChild(document.createElement("span"));
      c.className = "org-backlinks-count";
      c.textContent = String(count);
    }
    onTap(header, () => this.actions.toggle(id));
  }

  private fileTitle(parent: HTMLElement, title: string, path: string, line: number) {
    const el = parent.appendChild(document.createElement("div"));
    el.className = "org-backlinks-title";
    el.textContent = title;
    onTap(el, () => this.actions.open(path, line));
  }

  toDOM(view: EditorView) {
    const { backlinks, mentions, linkedOpen, mentionsOpen } = this.data;
    const root = document.createElement("div");
    root.className = "org-backlinks";

    this.header(view, root, "linked", "Linked mentions", backlinks.length, linkedOpen);
    if (linkedOpen) {
      const list = root.appendChild(document.createElement("div"));
      list.className = "org-backlinks-list";
      if (!backlinks.length) {
        const empty = list.appendChild(document.createElement("div"));
        empty.className = "org-backlinks-empty";
        empty.textContent = "No backlinks.";
      }
      for (const b of backlinks) {
        const file = list.appendChild(document.createElement("div"));
        file.className = "org-backlinks-file";
        this.fileTitle(file, b.title, b.path, b.lines[0]?.line ?? 0);
        for (const { line, text } of b.lines) {
          const row = file.appendChild(document.createElement("div"));
          row.className = "org-backlinks-line";
          row.textContent = text;
          onTap(row, () => this.actions.open(b.path, line));
        }
      }
    }

    this.header(view, root, "mentions", "Unlinked mentions", mentions ? mentions.length : null, mentionsOpen);
    if (mentionsOpen && mentions) {
      const list = root.appendChild(document.createElement("div"));
      list.className = "org-backlinks-list";
      if (!mentions.length) {
        const empty = list.appendChild(document.createElement("div"));
        empty.className = "org-backlinks-empty";
        empty.textContent = "No unlinked mentions.";
      }
      let file: HTMLElement | null = null;
      let lastPath = "";
      for (const m of mentions) {
        if (!file || m.path !== lastPath) {
          lastPath = m.path;
          file = list.appendChild(document.createElement("div"));
          file.className = "org-backlinks-file";
          this.fileTitle(file, m.title, m.path, m.line);
        }
        const row = file.appendChild(document.createElement("div"));
        row.className = "org-backlinks-line org-backlinks-mention";
        const text = row.appendChild(document.createElement("span"));
        text.className = "org-backlinks-mention-text";
        text.textContent = m.text;
        onTap(text, () => this.actions.open(m.path, m.line));
        const button = row.appendChild(document.createElement("button"));
        button.className = "org-backlinks-link-button";
        button.textContent = "Link";
        button.setAttribute("aria-label", `Link "${m.words}"`);
        onTap(button, () => {
          if (button.disabled) return;
          button.disabled = true;
          this.actions.link(m);
        });
      }
    }
    return root;
  }
}

function build(state: EditorState, data: BacklinksData | null, actions: BacklinksActions): DecorationSet {
  if (!data) return Decoration.none;
  return Decoration.set(Decoration.widget({ widget: new BacklinksWidget(data, actions), block: true, side: 1 }).range(state.doc.length));
}

/** BL-5: a widget below the text, never part of it. */
export function backlinksSection(actions: BacklinksActions) {
  return StateField.define<{ data: BacklinksData | null; decorations: DecorationSet }>({
    create: () => ({ data: null, decorations: Decoration.none }),
    update(value, tr) {
      let data = value.data;
      for (const e of tr.effects) if (e.is(setBacklinks)) data = e.value;
      if (data === value.data && !tr.docChanged) return value;
      return { data, decorations: build(tr.state, data, actions) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });
}
