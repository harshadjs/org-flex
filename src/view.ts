// The org file view (§2): a TextFileView holding the plugin's own CodeMirror
// editor.

import { Notice, setIcon, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { Compartment, EditorSelection, EditorState, Extension, Prec, StateField } from "@codemirror/state";
import { EditorView, keymap, scrollPastEnd } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { searchKeymap, search } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import type OrgFlexPlugin from "./main";
import { BUTTONS, ButtonId } from "./settings";
import { nextVisibility, VISIBILITY_NAMES } from "./org/folding";
import {
  cycleTaskState, decreaseHeadingLevel, increaseHeadingLevel, insertIdLink, insertWikiLink,
  currentPlanningDate, PlanningKind, setPlanningDate, toggleCheckbox, toggleLeadingStars,
} from "./org/edit";
import { linkDescription, mentionLink, Mention } from "./org/vault-index";
import { docInfo, OrgHost, orgConfig, orgHost } from "./editor/state";
import { livePreview } from "./editor/preview";
import { srcHighlight } from "./editor/src-highlight";
import { applyVisibility, orgFolding, visibilityField } from "./editor/folding";
import { checklists } from "./editor/checklists";
import { frontMatterPanel } from "./editor/front-matter-panel";
import { BacklinksData, backlinksSection, setBacklinks } from "./editor/backlinks";
import { headingDrag } from "./editor/heading-drag";
import { shortcutBar } from "./editor/shortcut-bar";
import { orgCompletion } from "./editor/completion";
import { DatePickerModal } from "./ui/modals";

export const VIEW_TYPE = "org-flex";

export class OrgFlexView extends TextFileView {
  editor: EditorView | null = null;
  private configCompartment = new Compartment();
  private featureCompartment = new Compartment();
  private barCompartment = new Compartment();
  private vimCompartment = new Compartment();
  private vimOn = false;
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
    const old = this.editor.state.doc.toString();
    if (old === data) return;
    let start = 0;
    while (start < old.length && start < data.length && old[start] === data[start]) start++;
    let end = 0;
    while (end < old.length - start && end < data.length - start && old[old.length - 1 - end] === data[data.length - 1 - end]) end++;
    this.editor.dispatch({
      changes: { from: start, to: old.length - end, insert: data.slice(start, data.length - end) },
      userEvent: "external",
    });
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
        const file = app.metadataCache.getFirstLinkpathDest(target, this.file?.path ?? "");
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
      s.headingDragHandles ? headingDrag() : [],
    ];
  }

  private barExtension(): Extension {
    const s = this.plugin.settings;
    if (!s.showShortcutBar) return [];
    return shortcutBar({
      buttons: BUTTONS.filter((b) => s.shortcutBarButtons.includes(b.id)),
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
        docInfo,
        history(),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.lineWrapping,
        scrollPastEnd(),
        EditorView.contentAttributes.of(spell
          ? { spellcheck: "true", autocorrect: "on", autocapitalize: "on" }
          : { spellcheck: "false" }),
        livePreview(),
        srcHighlight,
        orgFolding(),
        checklists(),
        orgCompletion(),
        this.featureCompartment.of(this.featureExtension()),
        this.barCompartment.of(this.barExtension()),
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
    const effects: ReturnType<typeof unfoldEffect.of>[] = [];
    foldedRanges(editor.state).between(pos, pos, (from, to) => {
      if (from <= pos && to >= pos) effects.push(unfoldEffect.of({ from, to }));
    });
    editor.dispatch({
      effects: [...effects, EditorView.scrollIntoView(pos, { y: options.top ? "start" : "center" })],
      selection: EditorSelection.cursor(pos),
    });
    if (options.focus) editor.focus();
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
      case "demote": this.run(increaseHeadingLevel(state)); break;
      case "promote": this.run(decreaseHeadingLevel(state)); break;
      case "todo": this.run(cycleTaskState(state, keywords)); break;
      case "schedule": this.pickDate("SCHEDULED"); break;
      case "deadline": this.pickDate("DEADLINE"); break;
      case "checkbox": this.run(toggleCheckbox(state)); break;
      case "wiki-link": this.run(insertWikiLink(state)); break;
      case "journal": void this.plugin.openJournal(new Date()); break;
      case "journal-picker": this.plugin.browseJournal(); break;
      case "journal-calendar": this.plugin.openCalendar(); break;
      case "new-note": this.plugin.newNote(); break;
    }
  }

  private run(spec: Parameters<EditorView["dispatch"]>[0] | null) {
    if (spec && this.editor) this.editor.dispatch(spec);
  }

  /** Commands that edit (§9.3). */
  command(name: "stars" | "demote" | "promote" | "todo" | "checkbox" | "id-link" | "wiki-link") {
    const editor = this.editor;
    if (!editor) return;
    const state = editor.state;
    switch (name) {
      case "stars": this.run(toggleLeadingStars(state)); break;
      case "demote": this.run(increaseHeadingLevel(state)); break;
      case "promote": this.run(decreaseHeadingLevel(state)); break;
      case "todo": this.run(cycleTaskState(state, this.plugin.keywords())); break;
      case "checkbox": this.run(toggleCheckbox(state)); break;
      case "id-link": this.run(insertIdLink(state)); break;
      case "wiki-link": this.run(insertWikiLink(state)); break;
    }
  }

  /** FOLD-6 */
  cycleVisibility() {
    const editor = this.editor;
    if (!editor) return;
    const next = nextVisibility(editor.state.field(visibilityField));
    applyVisibility(editor, next);
    new Notice(`Visibility: ${VISIBILITY_NAMES[next]}`);
  }

  /** ACT-4 */
  pickDate(kind: PlanningKind) {
    const editor = this.editor;
    if (!editor) return;
    const hadFocus = editor.hasFocus;
    const pos = editor.state.selection.main.head;
    if (setPlanningDate(editor.state, kind, new Date(), pos) === null) {
      new Notice("Put the cursor under a heading first.");
      return;
    }
    const title = kind === "SCHEDULED" ? "Schedule" : "Deadline";
    new DatePickerModal(
      this.app,
      title,
      currentPlanningDate(editor.state, kind, pos),
      (date) => this.run(setPlanningDate(editor.state, kind, date, pos)),
      () => {
        if (hadFocus) editor.focus();
      },
    ).open();
  }

  // -------------------------------------------------------------------------
  // MOB-4: only .cm-scroller scrolls

  private lockOuterScroll() {
    const reset = () => {
      for (const el of [this.contentEl, this.containerEl, (this.leaf as unknown as { containerEl?: HTMLElement }).containerEl, this.editor?.dom, document.scrollingElement]) {
        if (el && el.scrollTop !== 0) el.scrollTop = 0;
      }
    };
    for (const el of [this.contentEl, this.containerEl]) {
      this.registerDomEvent(el, "scroll", reset);
    }
    this.registerDomEvent(document, "scroll", reset, { capture: false });
    this.registerDomEvent(this.contentEl, "focusin", () => window.setTimeout(reset, 0));
    const vv = window.visualViewport;
    if (vv) {
      const onResize = () => reset();
      vv.addEventListener("resize", onResize);
      this.register(() => vv.removeEventListener("resize", onResize));
    }
  }
}
