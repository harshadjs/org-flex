// The journal (§10): today's file, a list of days and a calendar.

import { Notice, TFile } from "obsidian";
import type OrgFlexPlugin from "../main";
import { FLAVOUR } from "../flavour";
import { journalEntries, journalFileContent, journalPathForDate } from "../org/journal";
import { JournalCalendarModal, JournalPickerModal } from "../ui/modals";
import type { Feature } from "./feature";

/** JRN-2: open (creating if needed) the journal file for `date` in the current tab. */
async function openJournal(plugin: OrgFlexPlugin, date: Date) {
  const { app } = plugin;
  try {
    const path = journalPathForDate(plugin.settings.journalFolder, date);
    let file = app.vault.getAbstractFileByPath(path);
    if (!file) {
      await plugin.ensureFolder(path.slice(0, path.lastIndexOf("/")));
      file = await app.vault.create(path, journalFileContent(date, FLAVOUR.journalTemplate, crypto.randomUUID()));
    }
    if (!(file instanceof TFile)) throw new Error(`${path} is not a file`);
    await app.workspace.getLeaf(false).openFile(file);
  } catch (e) {
    new Notice(`Couldn't open the journal: ${(e as Error).message}`);
  }
}

function orgPaths(plugin: OrgFlexPlugin): string[] {
  return plugin.app.vault.getFiles().filter((f) => f.extension === "org").map((f) => f.path);
}

/** JRN-3 */
function browseJournal(plugin: OrgFlexPlugin) {
  const entries = journalEntries(orgPaths(plugin), plugin.settings.journalFolder);
  if (!entries.length) {
    new Notice("No journal entries yet.");
    return;
  }
  new JournalPickerModal(plugin.app, entries, (entry) => {
    const file = plugin.app.vault.getAbstractFileByPath(entry.path);
    if (file instanceof TFile) void plugin.app.workspace.getLeaf(false).openFile(file);
  }).open();
}

/** JRN-4 */
function openCalendar(plugin: OrgFlexPlugin) {
  const days = new Set(journalEntries(orgPaths(plugin), plugin.settings.journalFolder).map((e) => e.date));
  new JournalCalendarModal(plugin.app, (day) => days.has(day), (date) => void openJournal(plugin, date)).open();
}

export const journal: Feature = {
  id: "journal",
  section: "10. Journal",
  load(plugin) {
    plugin.addCommand({ id: "open-todays-journal", name: "Open today's journal", callback: () => void openJournal(plugin, new Date()) });
    plugin.addCommand({ id: "browse-journal-entries", name: "Browse journal entries", callback: () => browseJournal(plugin) });
    plugin.addCommand({ id: "open-journal-calendar", name: "Open journal calendar", callback: () => openCalendar(plugin) });
    plugin.addRibbonIcon("calendar-days", "Open today's journal", () => void openJournal(plugin, new Date()));
  },
  buttons: {
    journal: (plugin) => void openJournal(plugin, new Date()),
    "journal-picker": (plugin) => browseJournal(plugin),
    "journal-calendar": (plugin) => openCalendar(plugin),
  },
};
