// Backlinks (§5a): linked and unlinked mentions at the end of every note.

import { Notice, TFile } from "obsidian";
import type { StateField } from "@codemirror/state";
import type { OrgFlexView } from "../view";
import { mentionLink, Mention } from "../org/vault-index";
import { BacklinksData, backlinksSection, setBacklinks } from "../editor/backlinks";
import type { Feature } from "./feature";

interface ViewState {
  field: StateField<unknown>;
  sections: { linked: boolean; mentions: boolean };
}

const states = new WeakMap<OrgFlexView, ViewState>();

function stateOf(view: OrgFlexView): ViewState {
  let state = states.get(view);
  if (!state) {
    const sections = { linked: true, mentions: false };
    const field = backlinksSection({
      open: (path, line) => void view.plugin.openAt(view.leaf, path, { line }),
      link: (mention) => void linkMention(view, mention),
      toggle: (section) => {
        sections[section] = !sections[section];
        refresh(view);
      },
    });
    states.set(view, (state = { field, sections }));
  }
  return state;
}

/** BL-5: recompute the backlinks section from the index. */
function refresh(view: OrgFlexView) {
  const editor = view.editor;
  if (!editor) return;
  const { sections } = stateOf(view);
  const index = view.plugin.index;
  const path = view.file?.path;
  let data: BacklinksData | null = null;
  if (path) {
    data = {
      backlinks: index.backlinks(path),
      mentions: sections.mentions ? index.unlinkedMentions(path) : null,
      linkedOpen: sections.linked,
      mentionsOpen: sections.mentions,
    };
  }
  editor.dispatch({ effects: setBacklinks.of(data) });
}

/** BL-3: turn a mention in another file into a link, if that file hasn't changed since. */
async function linkMention(view: OrgFlexView, mention: Mention) {
  const { app } = view;
  const note = view.file && view.plugin.index.notes.get(view.file.path);
  const target = app.vault.getAbstractFileByPath(mention.path);
  if (!note || !(target instanceof TFile)) return;
  let stale = false;
  await app.vault.process(target, (text) => {
    if (text.slice(mention.from, mention.to) !== mention.words) {
      stale = true;
      return text;
    }
    return text.slice(0, mention.from) + mentionLink(note, mention.words) + text.slice(mention.to);
  });
  if (stale) {
    new Notice(`${mention.title} changed since it was indexed; nothing was linked.`);
    refresh(view);
  }
}

export const backlinks: Feature = {
  id: "backlinks",
  section: "5a. Index and backlinks",
  load(plugin) {
    plugin.register(plugin.index.onChange(() => plugin.forEachView(refresh)));
  },
  editor: (view) => stateOf(view).field,
  opened: refresh,
};
