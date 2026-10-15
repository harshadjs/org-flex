// Org Flex: Org mode files in Obsidian, on the desktop and the phone.

import { getIcon, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { ButtonDef, buttonIconName, mergeSettings, migrateShortcutButtons, OrgFlexSettings, BAR_VERSION } from "./settings";
import { Keywords, classifyLink } from "./org/syntax";
import { readNote, VaultIndex } from "./org/vault-index";
import { journalEntries, journalFileContent, journalPathForDate } from "./org/journal";
import { noteFileContent, notePath, titleProblem } from "./org/new-note";
import { OrgFlexView, VIEW_TYPE } from "./view";
import { JournalCalendarModal, JournalPickerModal, NewNoteModal } from "./ui/modals";
import { registerTaskBlocks } from "./ui/tasks-block";
import { OrgFlexSettingTab } from "./ui/settings-tab";

export default class OrgFlexPlugin extends Plugin {
  settings!: OrgFlexSettings;
  index!: VaultIndex;

  async onload() {
    await this.loadSettings();

    this.index = new VaultIndex({
      paths: () => this.app.vault.getFiles().filter((f) => f.extension === "org").map((f) => f.path),
      read: async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`not a file: ${path}`);
        return this.app.vault.cachedRead(file);
      },
      keywords: () => this.keywords(),
    });
    this.register(this.index.onChange(() => this.forEachView((v) => v.refreshBacklinks())));

    this.registerView(VIEW_TYPE, (leaf) => new OrgFlexView(leaf, this));
    this.registerExtensions(["org"], VIEW_TYPE);

    this.app.workspace.onLayoutReady(() => {
      void this.index.build();
      const isOrg = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === "org";
      this.registerEvent(this.app.vault.on("create", (f) => { if (isOrg(f)) void this.index.update(f.path); }));
      this.registerEvent(this.app.vault.on("modify", (f) => { if (isOrg(f)) void this.index.update(f.path); }));
      this.registerEvent(this.app.vault.on("delete", (f) => { if (isOrg(f)) this.index.remove(f.path); }));
      this.registerEvent(this.app.vault.on("rename", (f, old) => {
        if (isOrg(f)) void this.index.rename(old, f.path);
        else if (old.endsWith(".org")) this.index.remove(old);
      }));
    });

    this.addCommands();
    this.addRibbonIcon("file-plus", "New org note", () => this.newNote());
    this.addRibbonIcon("calendar-days", "Open today's journal", () => void this.openJournal(new Date()));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFolder)) return;
      menu.addItem((item) => item.setTitle("New org note").setIcon("file-plus").onClick(() => this.newNote(file)));
    }));

    registerTaskBlocks(this);
    this.addSettingTab(new OrgFlexSettingTab(this.app, this));
  }

  // -------------------------------------------------------------------------
  // Settings

  async loadSettings() {
    this.settings = mergeSettings(await this.loadData());
    const { buttons, changed } = migrateShortcutButtons(this.settings.shortcutBarButtons, this.settings.shortcutBarVersion);
    this.settings.shortcutBarVersion = BAR_VERSION;
    if (changed) {
      this.settings.shortcutBarButtons = buttons;
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.forEachView((v) => v.applySettings());
  }

  keywords(): Keywords {
    return { todo: this.settings.todoKeywords, done: this.settings.doneKeywords };
  }

  /** BAR-7: the custom icon when Lucide knows it, else the default. */
  buttonIcon(def: ButtonDef): string {
    return buttonIconName(def, this.settings.shortcutCustomIcons[def.id], (name) => Boolean(getIcon(name)));
  }

  forEachView(fn: (view: OrgFlexView) => void) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof OrgFlexView) fn(leaf.view);
    }
  }

  private activeView(): OrgFlexView | null {
    return this.app.workspace.getActiveViewOfType(OrgFlexView);
  }

  // -------------------------------------------------------------------------
  // Commands (§9.3): the ids are a compatibility contract

  private addCommands() {
    const inView = (id: string, name: string, run: (view: OrgFlexView) => void) => {
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const view = this.activeView();
          if (!view) return false;
          if (!checking) run(view);
          return true;
        },
      });
    };
    inView("cycle-orgmode-visibility", "Cycle visibility (fold all / outline / expand all)", (v) => v.cycleVisibility());
    inView("org-toggle-stars", "Toggle leading stars (*)", (v) => v.command("stars"));
    inView("org-increase-heading-level", "Increase heading level (+*)", (v) => v.command("demote"));
    inView("org-decrease-heading-level", "Decrease heading level (-*)", (v) => v.command("promote"));
    inView("org-cycle-task-state", "Cycle task state (none -> TODO -> DONE)", (v) => v.command("todo"));
    inView("org-schedule-task", "Schedule task (SCHEDULED:)", (v) => v.pickDate("SCHEDULED"));
    inView("org-deadline-task", "Task deadline (DEADLINE:)", (v) => v.pickDate("DEADLINE"));
    inView("org-toggle-checkbox", "Toggle checkbox (- [ ])", (v) => v.command("checkbox"));
    inView("org-insert-id-link", "Insert ID link ([[id:]])", (v) => v.command("id-link"));
    inView("org-insert-wiki-link", "Insert wiki link ([[]])", (v) => v.command("wiki-link"));
    this.addCommand({ id: "open-todays-journal", name: "Open today's journal", callback: () => void this.openJournal(new Date()) });
    this.addCommand({ id: "browse-journal-entries", name: "Browse journal entries", callback: () => this.browseJournal() });
    this.addCommand({ id: "open-journal-calendar", name: "Open journal calendar", callback: () => this.openCalendar() });
    this.addCommand({ id: "new-org-note", name: "New org note", callback: () => this.newNote() });
  }

  // -------------------------------------------------------------------------
  // Opening files and links

  /** Open `path` in `leaf` and put the cursor on a line or at an offset, without focus. */
  async openAt(leaf: WorkspaceLeaf, path: string, where: { line?: number; offset?: number; top?: boolean }) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${path}`);
      return;
    }
    await leaf.openFile(file);
    const view = leaf.view;
    if (!(view instanceof OrgFlexView)) return;
    if (where.offset !== undefined) view.revealPosition(where.offset, { top: where.top });
    else if (where.line !== undefined) view.revealLine(where.line, { top: where.top });
  }

  /** LINK-1..3 */
  async openLink(target: string, sourcePath: string, leaf: WorkspaceLeaf) {
    const link = classifyLink(target);
    if (link.kind === "external") {
      window.open(link.url, "_blank");
      return;
    }
    if (link.kind === "id") {
      const found = await this.findId(link.id);
      if (!found) {
        new Notice(`No org entry has the ID "${link.id}".`);
        return;
      }
      await this.openAt(leaf, found.path, { offset: found.offset, top: true });
      return;
    }
    const path = link.path.split("::")[0];
    const cache = this.app.metadataCache;
    const file = cache.getFirstLinkpathDest(path, sourcePath) ?? cache.getFirstLinkpathDest(`${path}.org`, sourcePath);
    if (!file) {
      new Notice(`Not found: ${path}`);
      return;
    }
    await leaf.openFile(file);
  }

  /** LINK-3: the index first; an ID it doesn't know yet makes us read every org file. */
  async findId(id: string): Promise<{ path: string; offset: number } | null> {
    await Promise.race([this.index.ready, new Promise((r) => window.setTimeout(r, 2000))]);
    const hit = this.index.findId(id);
    if (hit) return hit;
    for (const file of this.app.vault.getFiles()) {
      if (file.extension !== "org") continue;
      const note = readNote(file.path, await this.app.vault.cachedRead(file));
      const found = note.ids.find((i) => i.id === id);
      if (found) return { path: file.path, offset: found.offset };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Journal (§10)

  private async ensureFolder(path: string) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  /** JRN-2: open (creating if needed) the journal file for `date` in the current tab. */
  async openJournal(date: Date) {
    try {
      const path = journalPathForDate(this.settings.journalFolder, date);
      let file = this.app.vault.getAbstractFileByPath(path);
      if (!file) {
        await this.ensureFolder(path.slice(0, path.lastIndexOf("/")));
        file = await this.app.vault.create(path, journalFileContent(date));
      }
      if (!(file instanceof TFile)) throw new Error(`${path} is not a file`);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice(`Couldn't open the journal: ${(e as Error).message}`);
    }
  }

  private journalPaths(): string[] {
    return this.app.vault.getFiles().filter((f) => f.extension === "org").map((f) => f.path);
  }

  /** JRN-3 */
  browseJournal() {
    const entries = journalEntries(this.journalPaths(), this.settings.journalFolder);
    if (!entries.length) {
      new Notice("No journal entries yet.");
      return;
    }
    new JournalPickerModal(this.app, entries, (entry) => {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
    }).open();
  }

  /** JRN-4 */
  openCalendar() {
    const days = new Set(journalEntries(this.journalPaths(), this.settings.journalFolder).map((e) => e.date));
    new JournalCalendarModal(this.app, (day) => days.has(day), (date) => void this.openJournal(date)).open();
  }

  // -------------------------------------------------------------------------
  // New org note (§10a)

  newNote(folder?: TFolder) {
    const active = this.app.workspace.getActiveFile();
    const parent = folder ?? this.app.fileManager.getNewFileParent(active?.path ?? "");
    const dir = parent.isRoot() ? "" : parent.path;
    new NewNoteModal(this.app, dir, (title) => this.createNote(dir, title)).open();
  }

  /** NOTE-3..5: create and open the note, or say why not. */
  async createNote(folder: string, raw: string): Promise<string | null> {
    const problem = titleProblem(raw);
    if (problem) return problem;
    const title = raw.trim();
    const path = notePath(folder, title);
    if (this.app.vault.getAbstractFileByPath(path)) return `${path} already exists.`;
    try {
      const file = await this.app.vault.create(path, noteFileContent(title, crypto.randomUUID()));
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      if (leaf.view instanceof OrgFlexView) {
        const view = leaf.view;
        view.revealPosition(view.editor?.state.doc.length ?? 0, { focus: true });
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
}
