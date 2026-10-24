// New org notes (§10a): a dialog for the title, in a chosen folder.

import { TFolder } from "obsidian";
import type OrgFlexPlugin from "../main";
import { noteFileContent, notePath, titleProblem } from "../org/new-note";
import { NewNoteModal } from "../ui/modals";
import type { Feature } from "./feature";

/** NOTE-1, NOTE-2 */
function newNote(plugin: OrgFlexPlugin, folder?: TFolder) {
  const { app } = plugin;
  const active = app.workspace.getActiveFile();
  const parent = folder ?? app.fileManager.getNewFileParent(active?.path ?? "");
  const dir = parent.isRoot() ? "" : parent.path;
  new NewNoteModal(app, dir, (title) => createNote(plugin, dir, title)).open();
}

/** NOTE-3..5: create and open the note, or say why not. */
async function createNote(plugin: OrgFlexPlugin, folder: string, raw: string): Promise<string | null> {
  const problem = titleProblem(raw);
  if (problem) return problem;
  const title = raw.trim();
  const path = notePath(folder, title);
  if (plugin.app.vault.getAbstractFileByPath(path)) return `${path} already exists.`;
  try {
    const file = await plugin.app.vault.create(path, noteFileContent(title, crypto.randomUUID()));
    await plugin.openNewNote(plugin.app.workspace.getLeaf(false), file);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export const newNoteFeature: Feature = {
  id: "new-note",
  section: "10a. New org note",
  load(plugin) {
    plugin.addCommand({ id: "new-org-note", name: "New org note", callback: () => newNote(plugin) });
    plugin.addRibbonIcon("file-plus", "New org note", () => newNote(plugin));
    plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFolder)) return;
      menu.addItem((item) => item.setTitle("New org note").setIcon("file-plus").onClick(() => newNote(plugin, file)));
    }));
  },
  buttons: { "new-note": (plugin) => newNote(plugin) },
};
