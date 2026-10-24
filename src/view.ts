// The org file view (§2): a TextFileView holding the plugin's own CodeMirror
// editor.

import { Notice, setIcon, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { Compartment, EditorSelection, EditorState, Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";
import type OrgFlexPlugin from "./main";
import { barButtons, ButtonId } from "./settings";
import { nextVisibility } from "./org/folding";
import { appendEntry } from "./org/capture";
import {
  assignId, cycleTaskState, insertBlock, insertHeading, decreaseHeadingLevel, increaseHeadingLevel, insertIdLink,
  currentPlanningDate, insertFileLinks, PlanningKind, recordingExtension, recordingName, setPlanningDate, toggleCheckbox, toggleLeadingStars,
} from "./org/edit";
import { linkDescription, mentionLink, Mention } from "./org/vault-index";
import { allowInReading, OrgHost, orgConfig, orgHost } from "./editor/state";
import { readingMode } from "./editor/reading";
import { revealZoomEffects, toggleZoom, zoomToHeadingAt } from "./editor/zoom";
import { applyVisibility, visibilityField } from "./editor/folding";
import { frontMatterPanel } from "./editor/front-matter-panel";
import { BacklinksData, backlinksSection, setBacklinks } from "./editor/backlinks";
import { shortcutBar } from "./editor/shortcut-bar";
import { insertLinkWithCompletion, linkButton } from "./editor/completion";
import { coreExtensions, externalChange, lockOuterScroll, trackKeyboard, VIEW_TYPE } from "./editor/setup";
import { DatePickerModal, RecorderModal } from "./ui/modals";
import { relativeLinkPath } from "./org/syntax";

export { VIEW_TYPE };

export class OrgFlexView extends TextFileView {
  editor: EditorView | null = null;
  private configCompartment = new Compartment();
  private featureCompartment = new Compartment();
  private barCompartment = new Compartment();
  private vimCompartment = new Compartment();
  private readingCompartment = new Compartment();
  private vimOn = false;
  /** RD-1: this tab shows its file in reading mode */
  reading = false;
  private readingButton: HTMLElement | null = null;
  private sections = { linked: true, mentions: false };
  private backlinksField: StateField<unknown>;

  constructor(leaf: WorkspaceLeaf, private plugin: OrgFlexPlugin) {
    super(leaf);
    this.backlinksField = backlinksSection({
      open: (path, line) => void this.plugin.openAt(this.leaf, path, { line }),
      link: (mention) => void this.linkMention(mention),
      toggle: (section) => {
        this.sections[section] = !this.sections[section];
        this.refreshBacklinks();
      },
    });
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getIcon() {
    return "list-tree";
  }

  canAcceptExtension(extension: string) {
    return extension === "org";
  }

  async onOpen() {
    this.contentEl.addClass("org-flex-view");
    this.lockOuterScroll();
    // BAR-1: the bar sits flush on the keyboard
    this.register(trackKeyboard(this.contentEl, window));
    this.readingButton = this.addAction("book-open", "Reading mode", () => this.toggleReading());
    this.showReadingButton();
  }

  /** RD-1: switch this tab between reading and editing. */
  toggleReading() {
    this.reading = !this.reading;
    this.showReadingButton();
    const editor = this.editor;
    if (!editor) return;
    // the keyboard goes down at once
    if (this.reading) editor.contentDOM.blur();
    editor.dispatch({
      effects: [this.readingCompartment.reconfigure(this.readingExtension()), this.barCompartment.reconfigure(this.barExtension())],
    });
  }

  private showReadingButton() {
    const button = this.readingButton;
    if (!button) return;
    setIcon(button, this.reading ? "pencil" : "book-open");
    button.setAttribute("aria-label", this.reading ? "Edit" : "Reading mode");
    button.toggleClass("is-active", this.reading);
  }

  private readingExtension(): Extension {
    if (!this.reading) return [];
    return readingMode({
      keywords: () => this.plugin.keywords(),
      pickDate: (kind, pos) => this.pickDate(kind, pos),
    });
  }

  async onClose() {
    // VIEW-3: saving reads the editor, so save first
    await super.onClose();
    this.editor?.destroy();
    this.editor = null;
  }

  getViewData(): string {
    return this.editor?.state.doc.toString() ?? this.data;
  }

  setViewData(data: string, clear: boolean) {
    if (!this.editor) {
      this.editor = new EditorView({ parent: this.contentEl });
      clear = true;
    }
    if (clear) {
      this.editor.setState(this.createState(data));
      applyVisibility(this.editor, this.plugin.settings.defaultFoldLevel);
      this.refreshBacklinks();
      return;
    }
    // VIEW-9: a change on disk is applied as an edit, keeping cursor, folds and history
    const changes = externalChange(this.editor.state.doc.toString(), data);
    if (changes) this.editor.dispatch({ changes, userEvent: "external" });
  }

  clear() {
    // the next setViewData builds a fresh state
  }

  private host(): OrgHost {
    const app = this.app;
    return {
      setIcon,
      openLink: (target) => void this.plugin.openLink(target, this.file?.path ?? "", this.leaf),
      imageSrc: (target) => {
        const file = this.plugin.resolveFile(target, this.file?.path ?? "");
        return file ? app.vault.getResourcePath(file) : null;
      },
      linkCompletions: () => {
        const index = this.plugin.index;
        const titled = index.titles().map(({ label, detail, id }) => ({
          label, detail, target: `id:${id}`, description: linkDescription(label), type: "note",
        }));
        // org files with a file-level ID are already listed by title
        const hasId = new Set(Array.from(index.notes.values())
          .filter((n) => n.ids.some((i) => i.heading === undefined)).map((n) => n.path));
        const files = app.vault.getFiles().filter((f) => !hasId.has(f.path)).map((f) => {
          const name = f.extension === "org" || f.extension === "md" ? f.basename : f.name;
          return {
            label: name,
            detail: f.parent && f.parent.path !== "/" ? f.parent.path : undefined,
            target: name,
            type: "file",
          };
        });
        return [...titled, ...files];
      },
      createNote: (title) => this.plugin.createNoteFromLink(title),
      title: () => (this.file && this.plugin.index.notes.get(this.file.path)?.title) || this.file?.basename || "",
      idCompletions: () => this.plugin.index.ids().map(({ id, path }) => ({ label: id, detail: path, target: id, type: "constant" })),
    };
  }

  private configExtension(): Extension {
    const s = this.plugin.settings;
    return orgConfig.of({
      keywords: this.plugin.keywords(),
      hideStars: s.hideStars,
      foldPropertyDrawers: s.foldPropertyDrawers,
      frontMatterPanel: s.frontMatterPanel,
    });
  }

  private featureExtension(): Extension {
    const s = this.plugin.settings;
    return [
      s.frontMatterPanel ? frontMatterPanel() : [],
      s.backlinks ? this.backlinksField : [],
    ];
  }

  private barExtension(): Extension {
    const s = this.plugin.settings;
    // RD-1: the bar edits, so reading mode has none
    if (!s.showShortcutBar || this.reading) return [];
    return shortcutBar({
      buttons: barButtons(s.shortcutBarButtons),
      icon: (def) => this.plugin.buttonIcon(def),
      setIcon,
      run: (id, view) => this.runButton(id, view),
    });
  }

  private vimEnabled(): boolean {
    return Boolean((this.app.vault as unknown as { getConfig(key: string): unknown }).getConfig("vimMode"));
  }

  private spellcheck(): boolean {
    return (this.app.vault as unknown as { getConfig(key: string): unknown }).getConfig("spellcheck") !== false;
  }

  private createState(doc: string): EditorState {
    this.vimOn = this.vimEnabled();
    const spell = this.spellcheck();
    return EditorState.create({
      doc,
      extensions: [
        this.vimCompartment.of(this.vimOn ? Prec.highest(vim()) : []),
        this.configCompartment.of(this.configExtension()),
        orgHost.of(this.host()),
        coreExtensions({ spellcheck: spell }),
        this.featureCompartment.of(this.featureExtension()),
        this.barCompartment.of(this.barExtension()),
        this.readingCompartment.of(this.readingExtension()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.requestSave();
          if (update.focusChanged) this.syncVim();
        }),
      ],
    });
  }

  /** VIEW-5: vim mode follows Obsidian's setting, checked on focus changes. */
  private syncVim() {
    const on = this.vimEnabled();
    if (!this.editor || on === this.vimOn) return;
    this.vimOn = on;
    this.editor.dispatch({ effects: this.vimCompartment.reconfigure(on ? Prec.highest(vim()) : []) });
  }

  /** VIEW-7: settings apply to the open view. */
  applySettings() {
    if (!this.editor) return;
    this.editor.dispatch({
      effects: [
        this.configCompartment.reconfigure(this.configExtension()),
        this.featureCompartment.reconfigure(this.featureExtension()),
        this.barCompartment.reconfigure(this.barExtension()),
      ],
    });
    this.refreshBacklinks();
  }

  /** BL-5: recompute the backlinks section from the index. */
  refreshBacklinks() {
    const editor = this.editor;
    if (!editor || !this.plugin.settings.backlinks) return;
    const path = this.file?.path;
    let data: BacklinksData | null = null;
    if (path) {
      data = {
        backlinks: this.plugin.index.backlinks(path),
        mentions: this.sections.mentions ? this.plugin.index.unlinkedMentions(path) : null,
        linkedOpen: this.sections.linked,
        mentionsOpen: this.sections.mentions,
      };
    }
    editor.dispatch({ effects: setBacklinks.of(data) });
  }

  /** BL-3: turn a mention in another file into a link, if that file hasn't changed since. */
  private async linkMention(mention: Mention) {
    const note = this.file && this.plugin.index.notes.get(this.file.path);
    const target = this.app.vault.getAbstractFileByPath(mention.path);
    if (!note || !(target instanceof TFile)) return;
    let stale = false;
    await this.app.vault.process(target, (text) => {
      if (text.slice(mention.from, mention.to) !== mention.words) {
        stale = true;
        return text;
      }
      return text.slice(0, mention.from) + mentionLink(note, mention.words) + text.slice(mention.to);
    });
    if (stale) {
      new Notice(`${mention.title} changed since it was indexed; nothing was linked.`);
      this.refreshBacklinks();
    }
  }

  /**
   * Put the cursor at `pos`, opening any fold around it, and scroll it into
   * view (to the top with `top`). Focus only when asked, so the mobile
   * keyboard stays down.
   */
  revealPosition(pos: number, options: { top?: boolean; focus?: boolean } = {}) {
    const editor = this.editor;
    if (!editor) return;
    pos = Math.min(pos, editor.state.doc.length);
    const effects: StateEffect<unknown>[] = revealZoomEffects(editor.state, pos);
    foldedRanges(editor.state).between(pos, pos, (from, to) => {
      if (from <= pos && to >= pos) effects.push(unfoldEffect.of({ from, to }));
    });
    editor.dispatch({
      effects: [...effects, EditorView.scrollIntoView(pos, { y: options.top ? "start" : "center" })],
      selection: EditorSelection.cursor(pos),
    });
    if (options.focus) editor.focus();
  }

  /** ZOOM-5: show the heading at `pos` zoomed in, scrolled to the top; anything else is revealed as usual. */
  revealHeading(pos: number) {
    if (this.editor && !zoomToHeadingAt(this.editor, pos)) this.revealPosition(pos, { top: true });
  }

  /** CAP-3: add a captured entry at the end, as one undoable edit, even in reading mode. False with no editor. */
  appendEntry(entry: string): boolean {
    const editor = this.editor;
    if (!editor) return false;
    editor.dispatch({ changes: appendEntry(editor.state.doc.toString(), entry), userEvent: "input.capture", annotations: allowInReading.of(true) });
    return true;
  }

  /** ATT-2: pick images or audio files (on the phone: gallery, camera, recorder or files), save and link them. */
  attach() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,audio/*";
    input.multiple = true;
    // some phone web views only open the chooser for an input in the page
    input.hide();
    document.body.appendChild(input);
    input.addEventListener("cancel", () => input.remove());
    input.addEventListener("change", () => {
      input.remove();
      const files = Array.from(input.files ?? []);
      if (files.length) void this.saveAttachments(files.map((f) => ({ name: f.name, data: f.arrayBuffer() })));
    });
    input.click();
  }

  /** ATT-4: record from the microphone, then save and link the recording. */
  record() {
    new RecorderModal(this.app, (blob, mime) => {
      void this.saveAttachments([{ name: recordingName(new Date(), recordingExtension(mime)), data: blob.arrayBuffer() }]);
    }).open();
  }

  /** ATT-3: each file saved where Obsidian puts attachments for this note, then linked at the cursor. */
  private async saveAttachments(files: { name: string; data: Promise<ArrayBuffer> }[]) {
    const note = this.file;
    if (!note) return;
    const paths: string[] = [];
    for (const f of files) {
      try {
        const path = await this.app.fileManager.getAvailablePathForAttachment(f.name, note.path);
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
        const file = await this.app.vault.createBinary(path, await f.data);
        paths.push(relativeLinkPath(note.path, file.path));
      } catch (e) {
        new Notice(`Couldn't save ${f.name}: ${(e as Error).message}`);
      }
    }
    if (this.editor && this.file === note) this.run(insertFileLinks(this.editor.state, paths));
  }

  revealLine(line: number, options: { top?: boolean; focus?: boolean } = {}) {
    if (!this.editor) return;
    const n = Math.max(1, Math.min(line + 1, this.editor.state.doc.lines));
    this.revealPosition(this.editor.state.doc.line(n).from, options);
  }

  // -------------------------------------------------------------------------
  // Shortcut bar and commands

  runButton(id: ButtonId, view: EditorView) {
    const state = view.state;
    const keywords = this.plugin.keywords();
    switch (id) {
      case "undo": undo(view); break;
      case "redo": redo(view); break;
      case "visibility": this.cycleVisibility(); break;
      case "zoom": toggleZoom(view); break;
      case "new-heading": this.run(insertHeading(state)); break;
      case "demote": this.run(increaseHeadingLevel(state)); break;
      case "promote": this.run(decreaseHeadingLevel(state)); break;
      case "todo": this.run(cycleTaskState(state, keywords)); break;
      case "schedule": this.pickDate("SCHEDULED"); break;
      case "deadline": this.pickDate("DEADLINE"); break;
      case "checkbox": this.run(toggleCheckbox(state)); break;
      case "src-block": this.run(insertBlock(state, "src")); break;
      case "quote-block": this.run(insertBlock(state, "quote")); break;
      case "wiki-link": linkButton(view); break;
      case "heading-id": this.run(assignId(state, crypto.randomUUID())); break;
      case "node-find": this.plugin.findNode(); break;
      case "journal": void this.plugin.openJournal(new Date()); break;
      case "journal-picker": this.plugin.browseJournal(); break;
      case "journal-calendar": this.plugin.openCalendar(); break;
      case "new-note": this.plugin.newNote(); break;
      case "capture": this.plugin.capture(); break;
      case "attach": this.attach(); break;
      case "record": this.record(); break;
    }
  }

  private run(spec: Parameters<EditorView["dispatch"]>[0] | null) {
    if (spec && this.editor) this.editor.dispatch(spec);
  }

  /** Commands that edit (§9.3). */
  command(name: "stars" | "new-heading" | "demote" | "promote" | "todo" | "checkbox" | "src-block" | "quote-block" | "id-link" | "wiki-link" | "heading-id") {
    const editor = this.editor;
    if (!editor) return;
    const state = editor.state;
    switch (name) {
      case "stars": this.run(toggleLeadingStars(state)); break;
      case "new-heading": this.run(insertHeading(state)); break;
      case "demote": this.run(increaseHeadingLevel(state)); break;
      case "promote": this.run(decreaseHeadingLevel(state)); break;
      case "todo": this.run(cycleTaskState(state, this.plugin.keywords())); break;
      case "checkbox": this.run(toggleCheckbox(state)); break;
      case "src-block": this.run(insertBlock(state, "src")); break;
      case "quote-block": this.run(insertBlock(state, "quote")); break;
      case "id-link": insertLinkWithCompletion(editor, insertIdLink(state)); break;
      case "wiki-link": linkButton(editor); break;
      case "heading-id": this.run(assignId(state, crypto.randomUUID())); break;
    }
  }

  /** ZOOM-1, ZOOM-3 */
  toggleZoom() {
    if (this.editor) toggleZoom(this.editor);
  }

  /** FOLD-6 */
  cycleVisibility() {
    const editor = this.editor;
    if (!editor) return;
    const next = nextVisibility(editor.state.field(visibilityField));
    applyVisibility(editor, next);
  }

  /** ACT-4 */
  pickDate(kind: PlanningKind, pos?: number) {
    const editor = this.editor;
    if (!editor) return;
    const hadFocus = editor.hasFocus;
    pos ??= editor.state.selection.main.head;
    if (setPlanningDate(editor.state, kind, new Date(), pos) === null) {
      new Notice("Put the cursor under a heading first.");
      return;
    }
    const title = kind === "SCHEDULED" ? "Schedule" : "Deadline";
    new DatePickerModal(
      this.app,
      title,
      currentPlanningDate(editor.state, kind, pos),
      // RD-4: let through in reading mode too
      (date) => {
        const spec = setPlanningDate(editor.state, kind, date, pos);
        if (spec) editor.dispatch(spec, { annotations: allowInReading.of(true) });
      },
      () => {
        if (hadFocus) editor.focus();
      },
    ).open();
  }

  // -------------------------------------------------------------------------
  // MOB-4: only .cm-scroller scrolls

  private lockOuterScroll() {
    const leafEl = (this.leaf as unknown as { containerEl?: HTMLElement }).containerEl;
    this.register(lockOuterScroll(
      () => [this.contentEl, this.containerEl, leafEl, this.editor?.dom, document.scrollingElement],
      [this.contentEl, this.containerEl],
      this.contentEl,
      window,
    ));
  }
}
