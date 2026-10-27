// Org Flex: Org mode files in Obsidian, on the desktop and the phone.

import { FileView, getIcon, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { ButtonDef, buttonIconName, CORE_BUTTONS, mergeSettings, migrateShortcutButtons, OrgFlexSettings, BAR_VERSION } from "./settings";
import { Keywords, classifyLink, resolveRelative } from "./org/syntax";
import { LinkScheme, readNote, searchOffset, VaultIndex } from "./org/vault-index";
import { freeNotePath, noteFileContent, noteFileName, notePath } from "./org/new-note";
import { DenoteFiles, denoteFrontMatter, denoteTabTitle } from "./org/denote";
import { OrgFlexView, VIEW_TYPE } from "./view";
import { FLAVOUR } from "./flavour";
import { orgConflictMessage } from "./conflicts";
import { buttonFeature, FEATURES } from "./features";
import { OrgFlexSettingTab } from "./ui/settings-tab";

export default class OrgFlexPlugin extends Plugin {
  settings!: OrgFlexSettings;
  index!: VaultIndex;
  /** DEN-2: every file with a Denote identifier in its name, org or not */
  denote = new DenoteFiles();

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

    this.registerView(VIEW_TYPE, (leaf) => new OrgFlexView(leaf, this));
    this.claimOrgFiles();

    this.app.workspace.onLayoutReady(() => {
      void this.index.build().then(() => this.refreshTitles());
      if (this.scheme() === "denote") this.readableTitles();
      this.denote = new DenoteFiles(this.app.vault.getFiles().map((f) => f.path));
      const isOrg = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === "org";
      this.registerEvent(this.app.vault.on("create", (f) => {
        if (f instanceof TFile) this.denote.add(f.path);
        if (isOrg(f)) void this.index.update(f.path);
      }));
      this.registerEvent(this.app.vault.on("modify", (f) => {
        if (isOrg(f)) void this.index.update(f.path).then(() => this.refreshTitles(f.path));
      }));
      this.registerEvent(this.app.vault.on("delete", (f) => {
        if (f instanceof TFile) this.denote.remove(f.path);
        if (isOrg(f)) this.index.remove(f.path);
      }));
      this.registerEvent(this.app.vault.on("rename", (f, old) => {
        if (f instanceof TFile) this.denote.rename(old, f.path);
        if (isOrg(f)) void this.index.rename(old, f.path);
        else if (old.endsWith(".org")) this.index.remove(old);
      }));
    });

    this.addCommands();
    // PLAT-8: everything else comes from the features this copy has
    for (const feature of FEATURES) feature.load?.(this);
    this.addSettingTab(new OrgFlexSettingTab(this.app, this));
  }

  /** PLAT-3, PLAT-6: open .org files in the org view, or explain who has them already. */
  private claimOrgFiles() {
    try {
      this.registerExtensions(["org"], VIEW_TYPE);
    } catch {
      // not public API: only used to name the culprit, so guarded
      const app = this.app as unknown as {
        plugins?: { enabledPlugins?: Set<string> };
        viewRegistry?: { getTypeByExtension?: (ext: string) => string | undefined };
      };
      const owner = app.viewRegistry?.getTypeByExtension?.("org") ?? null;
      new Notice(orgConflictMessage(app.plugins?.enabledPlugins ?? [], owner), 0);
    }
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
    return { todo: FLAVOUR.todoKeywords, done: FLAVOUR.doneKeywords };
  }

  /** DEN-1: how this copy links notes. */
  scheme(): LinkScheme {
    return FLAVOUR.links;
  }

  /**
   * DEN-9: tabs show a Denote file by its title, not its `@@ID--slug` name,
   * whatever view has it open (org, Markdown, image, audio, PDF).
   */
  private readableTitles() {
    const patched = new WeakSet<FileView>();
    const patch = () => {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view;
        if (!(view instanceof FileView) || patched.has(view)) return;
        patched.add(view);
        const own = view.getDisplayText.bind(view);
        view.getDisplayText = () => {
          const path = view.file?.path;
          return (path && denoteTabTitle(path, this.index.notes.get(path)?.title)) || own();
        };
        this.register(() => { view.getDisplayText = own; updateHeader(leaf); });
        updateHeader(leaf);
      });
    };
    patch();
    this.registerEvent(this.app.workspace.on("layout-change", patch));
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshTitles()));
  }

  /** DEN-9: redraw the tab titles, of every tab or those showing `path`. */
  refreshTitles(path?: string) {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof FileView && (!path || leaf.view.file?.path === path)) updateHeader(leaf);
    });
  }

  /** identifiers handed out this session, before their files show up */
  private givenIds = new Set<string>();

  /** IDX-3: a new org ID from the flavour, never one the vault has or one already given out. */
  newOrgId(): string {
    const taken = new Set([...this.index.ids().map((i) => i.id), ...this.givenIds]);
    const id = FLAVOUR.orgId(Math.floor((performance.timeOrigin + performance.now()) * 1000), taken);
    this.givenIds.add(id);
    return id;
  }

  /** DEN-5, DEN-6: a new Denote identifier, never one a file has or one already given out. */
  newDenoteId(date: Date, journal = false): string {
    const taken = new Set([...this.denote.ids(), ...this.givenIds]);
    const id = (journal ? FLAVOUR.journalId : FLAVOUR.denoteId)(date, taken);
    this.givenIds.add(id);
    return id;
  }

  /** BAR-2, PLAT-8: a button shows only when the core or one of this copy's features runs it. */
  hasButton(def: ButtonDef): boolean {
    return CORE_BUTTONS.has(def.id) || buttonFeature(def.id) !== undefined;
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

  activeView(): OrgFlexView | null {
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
    inView("org-insert-heading", "Insert heading (M-RET)", (v) => v.command("new-heading"));
    inView("org-increase-heading-level", "Increase heading level (+*)", (v) => v.command("demote"));
    inView("org-decrease-heading-level", "Decrease heading level (-*)", (v) => v.command("promote"));
    inView("org-cycle-task-state", "Cycle task state (none -> TODO -> DONE)", (v) => v.command("todo"));
    inView("org-schedule-task", "Schedule task (SCHEDULED:)", (v) => v.pickDate("SCHEDULED"));
    inView("org-deadline-task", "Task deadline (DEADLINE:)", (v) => v.pickDate("DEADLINE"));
    inView("org-toggle-checkbox", "Toggle checkbox (- [ ])", (v) => v.command("checkbox"));
    inView("org-insert-src-block", "Insert source block (#+begin_src)", (v) => v.command("src-block"));
    inView("org-insert-quote-block", "Insert quote block (#+begin_quote)", (v) => v.command("quote-block"));
    inView("org-insert-id-link", "Insert ID link ([[id:]])", (v) => v.command("id-link"));
    inView("org-insert-wiki-link", "Insert wiki link ([[]])", (v) => v.command("wiki-link"));
    inView("org-zoom", "Zoom into heading / zoom out", (v) => v.toggleZoom());
    inView("org-toggle-reading", "Toggle reading mode", (v) => v.toggleReading());
    inView("org-assign-id", "Assign ID to heading (:ID:)", (v) => v.command("heading-id"));
  }

  // -------------------------------------------------------------------------
  // Opening files and links

  /** Open `path` in `leaf` and put the cursor on a line or at an offset, without focus. */
  async openAt(leaf: WorkspaceLeaf, path: string, where: { line?: number; offset?: number; top?: boolean; zoom?: boolean }) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${path}`);
      return;
    }
    await leaf.openFile(file);
    const view = leaf.view;
    if (!(view instanceof OrgFlexView)) return;
    if (where.offset !== undefined && where.zoom) view.revealHeading(where.offset);
    else if (where.offset !== undefined) view.revealPosition(where.offset, { top: where.top });
    else if (where.line !== undefined) view.revealLine(where.line, { top: where.top });
  }

  /** LINK-1..3 */
  async openLink(target: string, sourcePath: string, leaf: WorkspaceLeaf) {
    const link = classifyLink(target);
    if (link.kind === "external") {
      window.open(link.url, "_blank");
      return;
    }
    if (link.kind === "denote") {
      // DEN-1: the file named with the identifier, at the `::` search if there is one
      const path = this.denote.path(link.id);
      if (!path) {
        new Notice(`No file has the Denote identifier "${link.id}".`);
        return;
      }
      if (path.endsWith(".org")) {
        await Promise.race([this.index.ready, new Promise((r) => window.setTimeout(r, 2000))]);
        const note = this.index.notes.get(path);
        const offset = note && link.search ? searchOffset(note, link.search, this.keywords()) : null;
        await this.openAt(leaf, path, offset !== null ? { offset, top: true, zoom: true } : {});
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await leaf.openFile(file);
      return;
    }
    if (link.kind === "id") {
      const found = await this.findId(link.id);
      if (!found) {
        new Notice(`No org entry has the ID "${link.id}".`);
        return;
      }
      await this.openAt(leaf, found.path, { offset: found.offset, top: true, zoom: true });
      return;
    }
    const path = link.path.split("::")[0];
    const file = this.resolveFile(path, sourcePath);
    if (!file) {
      new Notice(`Not found: ${path}`);
      return;
    }
    await leaf.openFile(file);
  }

  /** LINK-2: a file link's target: relative to the note first (as Org reads it), then as Obsidian finds links, then with `.org`. */
  resolveFile(target: string, sourcePath: string): TFile | null {
    const relative = resolveRelative(sourcePath, target);
    const exact = relative !== null ? this.app.vault.getAbstractFileByPath(relative) : null;
    if (exact instanceof TFile) return exact;
    const path = target.replace(/^file:/i, "").split("::")[0];
    const cache = this.app.metadataCache;
    return cache.getFirstLinkpathDest(path, sourcePath) ?? cache.getFirstLinkpathDest(`${path}.org`, sourcePath);
  }

  /** LINK-2, DEN-1: the file a link names: by Denote identifier, or as a file link. */
  linkFile(target: string, sourcePath: string): TFile | null {
    const link = classifyLink(target);
    if (link.kind === "denote") {
      const path = this.denote.path(link.id);
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return file instanceof TFile ? file : null;
    }
    return link.kind === "file" ? this.resolveFile(link.path, sourcePath) : null;
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
  // Notes, for links and the features

  /** Make the folders of `path` that are missing, one at a time. */
  async ensureFolder(path: string) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  /** paths being created by createNoteFromLink, not yet in the vault */
  private pendingNotes = new Set<string>();

  /**
   * LP-10: create a note at the vault root for a title picked in the `[[`
   * list, without opening it. The link target is returned straight away.
   */
  createNoteFromLink(raw: string): string {
    return this.createRootNote(raw).target;
  }

  /**
   * NOTE-3, NOTE-5, DEN-5: a new note's path in `folder` and its contents:
   * `<title>.org` with a new `:ID:` (IDX-3), or with Denote `ID--title.org` and Denote's front matter.
   */
  newNote(folder: string, title: string): { path: string; content: string; target: string } {
    if (this.scheme() === "denote") {
      const now = new Date();
      const id = this.newDenoteId(now);
      return { path: notePath(folder, title, id), content: denoteFrontMatter(title, now, [], id), target: `denote:${id}` };
    }
    const id = this.newOrgId();
    return { path: notePath(folder, title), content: noteFileContent(title, id), target: `id:${id}` };
  }

  /** LP-10, FIND-3: a note at the vault root; the link target now, the file once written (null if it failed). */
  createRootNote(raw: string): { target: string; file: Promise<TFile | null> } {
    const title = raw.trim();
    const note = this.newNote("", title);
    // the title as file name may be taken; a Denote name has a new identifier, so it can't be
    const { path, content } = this.scheme() === "denote" ? note : {
      path: freeNotePath("", noteFileName(title), (p) => this.pendingNotes.has(p) || this.app.vault.getAbstractFileByPath(p) !== null),
      content: note.content,
    };
    this.pendingNotes.add(path);
    const file = this.app.vault.create(path, content)
      .catch((e: Error) => {
        new Notice(`Org Flex: couldn't create ${path}: ${e.message}`);
        return null;
      })
      .finally(() => this.pendingNotes.delete(path));
    return { target: note.target, file };
  }

  /** NOTE-5: open a new note with the cursor below its header, ready to type. */
  async openNewNote(leaf: WorkspaceLeaf, file: TFile) {
    await leaf.openFile(file);
    if (leaf.view instanceof OrgFlexView) {
      const view = leaf.view;
      view.revealPosition(view.editor?.state.doc.length ?? 0, { focus: true });
    }
  }
}

/** not public API: redraws a tab's title from its view's `getDisplayText` */
function updateHeader(leaf: WorkspaceLeaf) {
  (leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
}
