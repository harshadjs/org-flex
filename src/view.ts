// The org file view (§2): a TextFileView holding the plugin's own CodeMirror
// editor.

import { Notice, setIcon, TextFileView, WorkspaceLeaf } from "obsidian";
import { Compartment, EditorSelection, EditorState, Extension, Prec, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";
import type OrgFlexPlugin from "./main";
import { barButtons, ButtonId } from "./settings";
import { FLAVOUR } from "./flavour";
import { buttonFeature, FEATURES, hasFeature } from "./features";
import { nextVisibility } from "./org/folding";
import { appendEntry } from "./org/capture";
import {
  assignId, cycleTaskState, insertBlock, insertHeading, decreaseHeadingLevel, increaseHeadingLevel, insertIdLink,
  currentPlanningDate, PlanningKind, setPlanningDate, toggleCheckbox, toggleLeadingStars,
} from "./org/edit";
import { linkDescription } from "./org/vault-index";
import { allowInReading, OrgHost, orgConfig, orgHost } from "./editor/state";
import { readingMode } from "./editor/reading";
import { revealZoomEffects, toggleZoom, zoomToHeadingAt } from "./editor/zoom";
import { applyVisibility, visibilityField } from "./editor/folding";
import { shortcutBar } from "./editor/shortcut-bar";
import { insertLinkWithCompletion, linkButton } from "./editor/completion";
import { coreExtensions, externalChange, lockOuterScroll, trackKeyboard, VIEW_TYPE } from "./editor/setup";
import { DatePickerModal } from "./ui/modals";

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

  constructor(leaf: WorkspaceLeaf, readonly plugin: OrgFlexPlugin) {
    super(leaf);
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
      applyVisibility(this.editor, FLAVOUR.defaultFoldLevel);
      for (const feature of FEATURES) feature.opened?.(this);
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
    const s = FLAVOUR;
    return orgConfig.of({
      keywords: this.plugin.keywords(),
      hideStars: s.hideStars,
      foldPropertyDrawers: s.foldPropertyDrawers,
      frontMatterPanel: hasFeature("front-matter"),
    });
  }

  /** PLAT-8: what each feature adds to the editor. */
  private featureExtension(): Extension {
    return FEATURES.map((f) => f.editor?.(this) ?? []);
  }

  private barExtension(): Extension {
    const s = this.plugin.settings;
    // RD-1: the bar edits, so reading mode has none
    if (!s.showShortcutBar || this.reading) return [];
    return shortcutBar({
      buttons: barButtons(s.shortcutBarButtons).filter((b) => this.plugin.hasButton(b)),
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
    for (const feature of FEATURES) feature.settingsChanged?.(this);
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
      // PLAT-8: the rest belong to features
      default: buttonFeature(id)?.buttons?.[id]?.(this.plugin, this);
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
