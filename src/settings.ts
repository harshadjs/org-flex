// Settings (§12) and the shortcut bar's button list (§9.1). No Obsidian
// imports, so the defaults and the upgrade step can be tested.


export type ButtonId =
  | "undo" | "redo" | "visibility" | "zoom" | "new-heading" | "demote" | "promote" | "todo" | "schedule" | "deadline"
  | "checkbox" | "src-block" | "quote-block" | "table" | "wiki-link" | "node-find" | "heading-id" | "journal" | "journal-picker" | "journal-calendar" | "new-note" | "capture" | "attach" | "record" | "agenda" | "timeline"
  | "bold" | "italic" | "code" | "verbatim" | "strike" | "underline";

export interface ButtonDef {
  id: ButtonId;
  name: string;
  icon: string;
  /**
   * edits text: gives focus back to the editor if it had it; "always" focuses
   * it even if it didn't, for buttons you press to start typing (BAR-4)
   */
  refocus: boolean | "always";
}

/** BAR-2: every button. */
export const BUTTONS: ButtonDef[] = [
  { id: "undo", name: "Undo", icon: "undo-2", refocus: true },
  { id: "redo", name: "Redo", icon: "redo-2", refocus: true },
  { id: "new-heading", name: "New heading", icon: "square-plus", refocus: "always" },
  { id: "src-block", name: "Insert source block", icon: "code-xml", refocus: "always" },
  { id: "quote-block", name: "Insert quote block", icon: "quote", refocus: "always" },
  // TBL-6: it focuses the new table's first cell itself
  { id: "table", name: "Insert table", icon: "table", refocus: false },
  { id: "wiki-link", name: "Link", icon: "link", refocus: true },
  { id: "checkbox", name: "Toggle checkbox", icon: "square-check", refocus: true },
  { id: "heading-id", name: "Assign ID to heading", icon: "fingerprint", refocus: true },
  { id: "attach", name: "Attach file", icon: "paperclip", refocus: false },
  { id: "record", name: "Record voice note", icon: "mic", refocus: false },
  { id: "bold", name: "Bold", icon: "bold", refocus: true },
  { id: "italic", name: "Italic", icon: "italic", refocus: true },
  { id: "code", name: "Code", icon: "code", refocus: true },
  { id: "verbatim", name: "Verbatim", icon: "type", refocus: true },
  { id: "strike", name: "Strike-through", icon: "strikethrough", refocus: true },
  { id: "underline", name: "Underline", icon: "underline", refocus: true },
  { id: "todo", name: "Cycle task state", icon: "circle-check", refocus: true },
  { id: "schedule", name: "Schedule", icon: "calendar-clock", refocus: false },
  { id: "deadline", name: "Deadline", icon: "calendar-x", refocus: false },
  { id: "demote", name: "Increase heading level", icon: "indent", refocus: true },
  { id: "promote", name: "Decrease heading level", icon: "outdent", refocus: true },
  { id: "zoom", name: "Zoom into heading", icon: "zoom-in", refocus: true },
  { id: "visibility", name: "Cycle visibility", icon: "fold-vertical", refocus: false },
  { id: "journal", name: "Open today's journal", icon: "calendar-days", refocus: false },
  { id: "journal-picker", name: "Browse journal entries", icon: "book-open", refocus: false },
  { id: "journal-calendar", name: "Journal calendar", icon: "calendar", refocus: false },
  { id: "agenda", name: "Open agenda", icon: "calendar-range", refocus: false },
  { id: "timeline", name: "Open timeline", icon: "history", refocus: false },
  { id: "node-find", name: "Go to node", icon: "search", refocus: false },
  { id: "new-note", name: "New org note", icon: "file-plus", refocus: false },
  { id: "capture", name: "Capture to inbox", icon: "inbox", refocus: false },
];

/** PLAT-8: the buttons the core runs (`OrgFlexView.runButton`); the others belong to features. */
export const CORE_BUTTONS: ReadonlySet<ButtonId> = new Set<ButtonId>([
  "undo", "redo", "visibility", "zoom", "new-heading", "demote", "promote", "todo", "schedule", "deadline",
  "checkbox", "src-block", "quote-block", "table", "wiki-link", "heading-id",
  "bold", "italic", "code", "verbatim", "strike", "underline",
]);

export type GroupId = "insert" | "format" | "task" | "journal" | "open";

/** BAR-12: a button on the top row that opens a row of its own */
export interface BarGroup {
  id: GroupId;
  name: string;
  icon: string;
  buttons: ButtonId[];
  /** after one of its buttons, the bar stays on the group (Format) instead of going back to the top row */
  stays: boolean;
}

/** BAR-2, BAR-12: the groups, in top-row order, and what each holds, in order */
export const BAR_GROUPS: BarGroup[] = [
  { id: "insert", name: "Insert", icon: "plus", stays: false, buttons: ["src-block", "quote-block", "table", "wiki-link", "checkbox", "heading-id", "attach", "record"] },
  { id: "format", name: "Format", icon: "case-sensitive", stays: true, buttons: ["bold", "italic", "code", "verbatim", "strike", "underline"] },
  { id: "task", name: "Task and structure", icon: "list-checks", stays: false, buttons: ["todo", "schedule", "deadline", "demote", "promote", "zoom", "visibility"] },
  { id: "journal", name: "Journal", icon: "calendar-days", stays: false, buttons: ["journal", "journal-picker", "journal-calendar"] },
  { id: "open", name: "Open", icon: "compass", stays: false, buttons: ["agenda", "timeline", "node-find", "new-note", "capture"] },
];

/** BAR-2: the buttons always on the top row, before the groups */
export const TOP_BUTTONS: ButtonId[] = ["undo", "redo", "new-heading"];

export type BarItem = { kind: "button"; def: ButtonDef } | { kind: "group"; group: BarGroup; defs: ButtonDef[] };

/**
 * BAR-2, BAR-12: the top row: the top buttons, then each group with the
 * buttons this copy has (`has`, PLAT-8); a group left with none isn't shown.
 */
export function barLayout(has: (def: ButtonDef) => boolean): BarItem[] {
  const def = (id: ButtonId) => BUTTONS.find((b) => b.id === id)!;
  const items: BarItem[] = TOP_BUTTONS.map(def).filter(has).map((d) => ({ kind: "button" as const, def: d }));
  for (const group of BAR_GROUPS) {
    const defs = group.buttons.map(def).filter(has);
    if (defs.length) items.push({ kind: "group", group, defs });
  }
  return items;
}

/** §12: what differs between one person's vaults and devices; workflow choices are in the flavour (§12a). */
export interface OrgFlexSettings {
  showShortcutBar: boolean;
  journalFolder: string;
  captureFile: string;
}

export const DEFAULT_SETTINGS: OrgFlexSettings = {
  showShortcutBar: true,
  journalFolder: "journal",
  captureFile: "inbox.org",
};

/** §12: saved keys that are no longer settings (gone, or moved to the flavour, §12a); dropped on load. */
export const RETIRED_SETTINGS = [
  "headingDragHandles", "todoKeywords", "doneKeywords", "defaultPriority", "hideStars", "foldPropertyDrawers",
  "defaultFoldLevel", "frontMatterPanel", "backlinks", "journalTemplate",
  // BAR-12: the bar's groups are fixed, so its buttons, their order and icons aren't settings any more
  "shortcutBarButtons", "shortcutCustomIcons", "shortcutBarVersion",
];

/** Saved settings over the defaults, with arrays and objects copied (§12). */
export function mergeSettings(saved: Partial<OrgFlexSettings> | null | undefined): OrgFlexSettings {
  const merged: OrgFlexSettings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  for (const key of RETIRED_SETTINGS) delete (merged as unknown as Record<string, unknown>)[key];
  return merged;
}
