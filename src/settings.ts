// Settings (§12) and the shortcut bar's button list (§9.1). No Obsidian
// imports, so the defaults and the upgrade step can be tested.

import type { VisibilityLevel } from "./org/folding";

export type ButtonId =
  | "undo" | "redo" | "visibility" | "demote" | "promote" | "todo" | "schedule" | "deadline"
  | "checkbox" | "wiki-link" | "journal" | "journal-picker" | "journal-calendar" | "new-note";

export interface ButtonDef {
  id: ButtonId;
  name: string;
  icon: string;
  /** on in a fresh install (BAR-3) */
  enabled: boolean;
  /** edits text: gives focus back to the editor if it had it (BAR-4) */
  refocus: boolean;
}

/** BAR-2: every button, in bar order. */
export const BUTTONS: ButtonDef[] = [
  { id: "undo", name: "Undo", icon: "undo-2", enabled: true, refocus: true },
  { id: "redo", name: "Redo", icon: "redo-2", enabled: true, refocus: true },
  { id: "visibility", name: "Cycle visibility", icon: "fold-vertical", enabled: true, refocus: false },
  { id: "demote", name: "Increase heading level", icon: "indent", enabled: true, refocus: true },
  { id: "promote", name: "Decrease heading level", icon: "outdent", enabled: true, refocus: true },
  { id: "todo", name: "Cycle task state", icon: "circle-check", enabled: true, refocus: true },
  { id: "schedule", name: "Schedule", icon: "calendar-clock", enabled: true, refocus: false },
  { id: "deadline", name: "Deadline", icon: "calendar-x", enabled: true, refocus: false },
  { id: "checkbox", name: "Toggle checkbox", icon: "square-check", enabled: true, refocus: true },
  { id: "wiki-link", name: "Insert wiki link", icon: "link", enabled: true, refocus: true },
  { id: "journal", name: "Open today's journal", icon: "calendar-days", enabled: false, refocus: false },
  { id: "journal-picker", name: "Browse journal entries", icon: "book-open", enabled: false, refocus: false },
  { id: "journal-calendar", name: "Journal calendar", icon: "calendar", enabled: false, refocus: false },
  { id: "new-note", name: "New org note", icon: "file-plus", enabled: false, refocus: false },
];

export interface OrgFlexSettings {
  todoKeywords: string[];
  doneKeywords: string[];
  defaultPriority: string;
  hideStars: boolean;
  foldPropertyDrawers: boolean;
  defaultFoldLevel: VisibilityLevel;
  showShortcutBar: boolean;
  shortcutBarButtons: string[];
  shortcutCustomIcons: Record<string, string>;
  shortcutBarVersion: number;
  journalFolder: string;
  frontMatterPanel: boolean;
  backlinks: boolean;
  headingDragHandles: boolean;
}

export const BAR_VERSION = 4;

export const DEFAULT_SETTINGS: OrgFlexSettings = {
  todoKeywords: ["TODO", "DOING", "WAITING", "NEXT", "PENDING"],
  doneKeywords: ["DONE", "CANCELLED", "CANCELED", "CANCEL", "REJECTED", "STOP", "STOPPED"],
  defaultPriority: "B",
  hideStars: false,
  foldPropertyDrawers: true,
  defaultFoldLevel: "foldall",
  showShortcutBar: true,
  shortcutBarButtons: BUTTONS.filter((b) => b.enabled).map((b) => b.id),
  shortcutCustomIcons: {},
  shortcutBarVersion: BAR_VERSION,
  journalFolder: "journal",
  frontMatterPanel: true,
  backlinks: true,
  headingDragHandles: true,
};

/** Saved settings over the defaults, with arrays and objects copied (§12). */
export function mergeSettings(saved: Partial<OrgFlexSettings> | null | undefined): OrgFlexSettings {
  const merged: OrgFlexSettings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  merged.todoKeywords = [...merged.todoKeywords];
  merged.doneKeywords = [...merged.doneKeywords];
  merged.shortcutBarButtons = [...merged.shortcutBarButtons];
  merged.shortcutCustomIcons = { ...merged.shortcutCustomIcons };
  // a fresh install starts at the current version; saved settings without one are version 1
  if (saved && saved.shortcutBarVersion === undefined) merged.shortcutBarVersion = 1;
  return merged;
}

/**
 * BAR-8: upgrade a saved button list. Returns the new list and whether it
 * changed (then it must be saved).
 */
export function migrateShortcutButtons(buttons: string[], version: number): { buttons: string[]; changed: boolean } {
  let list = [...buttons];
  if (version >= BAR_VERSION) return { buttons: list, changed: false };
  if (version < 2) {
    list = ["undo", "redo", "visibility", ...list.filter((b) => b !== "undo" && b !== "redo" && b !== "visibility" && b !== "stars")];
  }
  if (version < 3 && !list.includes("id-link")) list.push("id-link");
  if (version < 4) list = list.map((b) => (b === "id-link" ? "wiki-link" : b));
  return { buttons: list, changed: true };
}

/** Keyword text areas: commas or newlines, blank entries dropped. */
export function parseKeywordList(text: string): string[] {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}
