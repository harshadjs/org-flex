// Links follow renames (§5b): when a file or folder is renamed or moved, the
// file links in org notes that pointed at it are rewritten, relative to each note.

import { Notice, TFile, TFolder } from "obsidian";
import type OrgFlexPlugin from "../main";
import { addMove, retargetLinks } from "../org/rename";
import type { Feature } from "./feature";

/** MV-1: renames are collected and handled together, 300 ms after the last. */
const BATCH_MS = 300;

function watch(plugin: OrgFlexPlugin) {
  const { vault } = plugin.app;
  const moves = new Map<string, string>();
  let timer: number | null = null;

  const record = (file: TFile | TFolder, oldPath: string) => {
    if (file instanceof TFile) addMove(moves, oldPath, file.path);
    else {
      // a folder: every file in it moved
      const walk = (folder: TFolder) => {
        for (const child of folder.children) {
          if (child instanceof TFolder) walk(child);
          else if (child instanceof TFile) addMove(moves, oldPath + child.path.slice(file.path.length), child.path);
        }
      };
      walk(file);
    }
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void flush();
    }, BATCH_MS);
  };

  const flush = async () => {
    const batch = new Map(moves);
    moves.clear();
    if (!batch.size) return;
    const backFrom = new Map(Array.from(batch, ([from, to]) => [to, from]));
    const exists = (path: string) => vault.getAbstractFileByPath(path) instanceof TFile;
    let count = 0;
    for (const note of vault.getFiles()) {
      if (note.extension !== "org") continue;
      const before = backFrom.get(note.path) ?? note.path;
      // MV-4: a cheap look first, so only notes with links are written
      if (retargetLinks(await vault.cachedRead(note), before, note.path, batch, exists) === null) continue;
      let changed = false;
      try {
        await vault.process(note, (text) => {
          const updated = retargetLinks(text, before, note.path, batch, exists);
          changed = updated !== null;
          return updated ?? text;
        });
      } catch (e) {
        new Notice(`Org Flex: couldn't update links in ${note.path}: ${(e as Error).message}`);
      }
      if (changed) count++;
    }
    if (count) new Notice(`Updated links in ${count} org ${count === 1 ? "file" : "files"}.`);
  };

  plugin.app.workspace.onLayoutReady(() => {
    plugin.registerEvent(vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile || file instanceof TFolder) record(file, oldPath);
    }));
  });
  plugin.register(() => {
    if (timer !== null) window.clearTimeout(timer);
  });
}

export const linkUpdate: Feature = {
  id: "link-update",
  section: "5b. Links follow renames",
  load: watch,
};
