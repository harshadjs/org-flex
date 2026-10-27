// Backlinks (§5a): linked and unlinked mentions at the end of every note,
// and the notes linking to a media file below it in its own view (BL-7).

import { FileView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { StateField } from "@codemirror/state";
import type { OrgFlexView } from "../view";
import type OrgFlexPlugin from "../main";
import { isMediaFile, mentionLink, Mention } from "../org/vault-index";
import { BacklinksData, backlinksSection, renderBacklinks, setBacklinks } from "../editor/backlinks";
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
  // BL-6: turned off, the section is empty and nothing is computed
  if (path && view.plugin.settings.showBacklinks) {
    data = {
      backlinks: index.backlinks(path),
      mentions: sections.mentions ? index.unlinkedMentions(path) : null,
      linkedOpen: sections.linked,
      mentionsOpen: sections.mentions,
    };
  }
  editor.dispatch({ effects: setBacklinks.of(data) });
}

const MEDIA_PANEL = "org-media-backlinks";
/** BL-7: whether each tab's list under a media file is open; open at first */
const mediaOpen = new WeakMap<WorkspaceLeaf, boolean>();

/**
 * BL-7: under each image, audio, video or PDF open in a tab, the notes with
 * a `[[file:…]]` link to it, as BL-1 lists them. Redrawn only when it changed.
 */
function refreshMedia(plugin: OrgFlexPlugin) {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!(view instanceof FileView)) return;
    const old = view.contentEl.querySelector(`:scope > .${MEDIA_PANEL}`);
    const file = view.file;
    // BL-6: turned off, no list under media files either
    if (!file || !isMediaFile(file.path) || !plugin.settings.showBacklinks) {
      old?.remove();
      return;
    }
    const data: BacklinksData = {
      backlinks: plugin.index.fileBacklinks(file.path),
      mentions: null,
      linkedOpen: mediaOpen.get(leaf) ?? true,
      mentionsOpen: false,
      linkedOnly: true,
    };
    const key = file.path + JSON.stringify(data);
    if (old instanceof HTMLElement && old.dataset.key === key) return;
    const panel = renderBacklinks(data, {
      open: (path, line) => void plugin.openAt(leaf, path, { line }),
      link: () => {},
      toggle: () => {
        mediaOpen.set(leaf, !(mediaOpen.get(leaf) ?? true));
        refreshMedia(plugin);
      },
    }, setIcon);
    panel.classList.add(MEDIA_PANEL);
    panel.dataset.key = key;
    if (old) old.replaceWith(panel);
    else view.contentEl.appendChild(panel);
  });
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
    return text.slice(0, mention.from) + mentionLink(note, mention.words, view.plugin.scheme()) + text.slice(mention.to);
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
    plugin.register(plugin.index.onChange(() => {
      plugin.forEachView(refresh);
      refreshMedia(plugin);
    }));
    const media = () => refreshMedia(plugin);
    plugin.registerEvent(plugin.app.workspace.on("layout-change", media));
    plugin.registerEvent(plugin.app.workspace.on("file-open", media));
    plugin.register(() => document.querySelectorAll(`.${MEDIA_PANEL}`).forEach((el) => el.remove()));
  },
  editor: (view) => stateOf(view).field,
  opened: refresh,
  settingsChanged(view) {
    refresh(view);
    refreshMedia(view.plugin);
  },
};
