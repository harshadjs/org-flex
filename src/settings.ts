// Settings (§12) and the shortcut bar's button list (§9.1). No Obsidian
// imports, so the defaults and the upgrade step can be tested.


export type ButtonId =
  | "undo" | "redo" | "visibility" | "zoom" | "new-heading" | "demote" | "promote" | "todo" | "schedule" | "deadline"
  | "checkbox" | "src-block" | "quote-block" | "wiki-link" | "node-find" | "heading-id" | "journal" | "journal-picker" | "journal-calendar" | "new-note" | "capture" | "attach" | "record";

export interface ButtonDef {
  id: ButtonId;
  name: string;
  icon: string;
  /** on in a fresh install (BAR-3) */
  enabled: boolean;
  /**
   * edits text: gives focus back to the editor if it had it; "always" focuses
   * it even if it didn't, for buttons you press to start typing (BAR-4)
   */
  refocus: boolean | "always";
}

/** BAR-2: every button, in bar order. */
export const BUTTONS: ButtonDef[] = [
  { id: "undo", name: "Undo", icon: "undo-2", enabled: true, refocus: true },
  { id: "redo", name: "Redo", icon: "redo-2", enabled: true, refocus: true },
  { id: "visibility", name: "Cycle visibility", icon: "fold-vertical", enabled: true, refocus: false },
  { id: "zoom", name: "Zoom into heading", icon: "zoom-in", enabled: true, refocus: true },
  { id: "new-heading", name: "New heading", icon: "square-plus", enabled: true, refocus: "always" },
  { id: "demote", name: "Increase heading level", icon: "indent", enabled: true, refocus: true },
  { id: "promote", name: "Decrease heading level", icon: "outdent", enabled: true, refocus: true },
  { id: "todo", name: "Cycle task state", icon: "circle-check", enabled: true, refocus: true },
  { id: "schedule", name: "Schedule", icon: "calendar-clock", enabled: true, refocus: false },
  { id: "deadline", name: "Deadline", icon: "calendar-x", enabled: true, refocus: false },
  { id: "checkbox", name: "Toggle checkbox", icon: "square-check", enabled: true, refocus: true },
  { id: "src-block", name: "Insert source block", icon: "code", enabled: true, refocus: "always" },
  { id: "quote-block", name: "Insert quote block", icon: "quote", enabled: true, refocus: "always" },
  { id: "wiki-link", name: "Insert wiki link", icon: "link", enabled: true, refocus: true },
  { id: "node-find", name: "Go to node", icon: "search", enabled: true, refocus: false },
  { id: "heading-id", name: "Assign ID to heading", icon: "fingerprint", enabled: true, refocus: true },
  { id: "journal", name: "Open today's journal", icon: "calendar-days", enabled: false, refocus: false },
  { id: "journal-picker", name: "Browse journal entries", icon: "book-open", enabled: false, refocus: false },
  { id: "journal-calendar", name: "Journal calendar", icon: "calendar", enabled: false, refocus: false },
  { id: "new-note", name: "New org note", icon: "file-plus", enabled: false, refocus: false },
  { id: "capture", name: "Capture to inbox", icon: "inbox", enabled: false, refocus: false },
  { id: "attach", name: "Attach image or audio", icon: "paperclip", enabled: false, refocus: false },
  { id: "record", name: "Record voice note", icon: "mic", enabled: false, refocus: false },
];

/** PLAT-8: the buttons the core runs (`OrgFlexView.runButton`); the others belong to features. */
export const CORE_BUTTONS: ReadonlySet<ButtonId> = new Set<ButtonId>([
  "undo", "redo", "visibility", "zoom", "new-heading", "demote", "promote", "todo", "schedule", "deadline",
  "checkbox", "src-block", "quote-block", "wiki-link", "heading-id",
]);

/** BAR-2: the buttons to show, always in `BUTTONS` order; unknown ids are ignored. */
export function barButtons(enabled: string[]): ButtonDef[] {
  return BUTTONS.filter((b) => enabled.includes(b.id));
}

/** BAR-7: a custom icon when it names a known icon, else the button's default. */
export function buttonIconName(def: ButtonDef, custom: string | undefined, known: (name: string) => boolean): string {
  const name = custom?.trim();
  return name && known(name) ? name : def.icon;
}

/** §12: what differs between one person's vaults and devices; workflow choices are in the flavour (§12a). */
export interface OrgFlexSettings {
  showShortcutBar: boolean;
  shortcutBarButtons: string[];
  shortcutCustomIcons: Record<string, string>;
  shortcutBarVersion: number;
  journalFolder: string;
  captureFile: string;
}

export const BAR_VERSION = 8;

export const DEFAULT_SETTINGS: OrgFlexSettings = {
  showShortcutBar: true,
  shortcutBarButtons: BUTTONS.filter((b) => b.enabled).map((b) => b.id),
  shortcutCustomIcons: {},
  shortcutBarVersion: BAR_VERSION,
  journalFolder: "journal",
  captureFile: "inbox.org",
};

/** §12: saved keys that are no longer settings (gone, or moved to the flavour, §12a); dropped on load. */
export const RETIRED_SETTINGS = [
  "headingDragHandles", "todoKeywords", "doneKeywords", "defaultPriority", "hideStars", "foldPropertyDrawers",
  "defaultFoldLevel", "frontMatterPanel", "backlinks", "journalTemplate",
];

/** Saved settings over the defaults, with arrays and objects copied (§12). */
export function mergeSettings(saved: Partial<OrgFlexSettings> | null | undefined): OrgFlexSettings {
  const merged: OrgFlexSettings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  for (const key of RETIRED_SETTINGS) delete (merged as unknown as Record<string, unknown>)[key];
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
  if (version < 5 && !list.includes("heading-id")) list.push("heading-id");
  if (version < 6 && !list.includes("new-heading")) list.push("new-heading");
  if (version < 7) for (const id of ["src-block", "quote-block"]) if (!list.includes(id)) list.push(id);
  if (version < 8) for (const id of ["zoom", "node-find"]) if (!list.includes(id)) list.push(id);
  return { buttons: list, changed: true };
}
