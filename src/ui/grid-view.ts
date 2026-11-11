// GRID-1..8: the notes grid, every org file as a card in Keep-style columns,
// with a search, label chips and a long-press menu to pin, colour and label.

import { App, ItemView, Modal, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type OrgFlexPlugin from "../main";
import { onTap } from "../editor/state";
import { renderInline } from "../editor/table";
import { parseInline } from "../org/syntax";
import { readNote } from "../org/vault-index";
import { FLAVOUR } from "../flavour";
import {
  cardLines, cleanGridFilter, cleanLabel, filterCards, GRID_COLORS, gridColumns, gridLabels, type GridCard, type GridColor,
  type GridFilter, hiddenFolder, masonry, readCard, setFileTags, setKeyword, sortCards,
} from "../org/grid";

export const GRID_VIEW = "org-flex-grid";

/** GRID-7: where this device keeps the filter */
const FILTER_KEY = "org-flex-grid-filter";

export class GridView extends ItemView {
  private timer: number | null = null;
  private typing: number | null = null;
  private cards: GridCard[] = [];
  private filter: GridFilter;
  private listEl: HTMLElement | null = null;
  private chipsEl: HTMLElement | null = null;
  private columns = 2;
  private resize: ResizeObserver | null = null;
  private scrollTo: number | null = null;
  /** the index has been read: until then the list says it is loading */
  private loaded = false;

  constructor(leaf: WorkspaceLeaf, private plugin: OrgFlexPlugin) {
    super(leaf);
    this.filter = cleanGridFilter(this.loadFilter());
  }

  getViewType() {
    return GRID_VIEW;
  }

  getDisplayText() {
    return "Notes";
  }

  getIcon() {
    return "layout-grid";
  }

  /** GRID-1: going back to the grid puts it where it was scrolled */
  getEphemeralState(): Record<string, unknown> {
    return { scroll: this.contentEl.scrollTop };
  }

  setEphemeralState(state: unknown) {
    const scroll = (state as { scroll?: unknown } | null)?.scroll;
    if (typeof scroll !== "number") return;
    this.scrollTo = scroll;
    this.contentEl.scrollTop = scroll;
  }

  async onOpen() {
    this.register(this.plugin.index.onChange(() => this.refreshSoon()));
    const vault = this.app.vault;
    for (const event of ["create", "delete", "rename", "modify"] as const) this.registerEvent(vault.on(event as "create", () => this.refreshSoon()));
    if (typeof ResizeObserver === "function") {
      this.resize = new ResizeObserver(() => {
        const columns = gridColumns(this.contentEl.clientWidth);
        if (columns !== this.columns) this.draw();
      });
      this.resize.observe(this.contentEl);
    }
    // GRID-1: the bar and a loading line at once; the cards once the index is read (on a phone that can take a while)
    this.ensureBar();
    this.listEl!.createDiv({ cls: "org-grid-empty", text: "Loading notes…" });
    // not awaited: Obsidian waits for onOpen while restoring tabs, and the index is only read after that
    void this.plugin.index.ready.then(() => this.render());
  }

  async onClose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.typing !== null) window.clearTimeout(this.typing);
    this.resize?.disconnect();
  }

  private refreshSoon() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.render();
    }, 300);
  }

  /** GRID-8: the folders kept out unless chosen: the journal's, then the flavour's */
  hidden(): string[] {
    return [...new Set([this.plugin.settings.journalFolder, ...FLAVOUR.gridHiddenFolders].map((f) => f.replace(/\/+$/, "")).filter(Boolean))];
  }

  /** GRID-2: every org file in the index as a card, then drawn as filtered */
  render() {
    this.ensureBar();
    this.loaded = true;
    try {
      this.cards = [];
      for (const note of this.plugin.index.notes.values()) {
        const file = this.app.vault.getAbstractFileByPath(note.path);
        this.cards.push(readCard(note, file instanceof TFile ? file.stat.mtime : 0));
      }
      this.draw();
    } catch (e) {
      // GRID-1: a failure says so in the tab instead of leaving it blank
      console.error("Org Flex: the notes grid failed", e);
      this.listEl!.empty();
      this.listEl!.createDiv({ cls: "org-grid-empty", text: `Couldn't draw the notes: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** GRID-7: the search box, made once so typing keeps its focus */
  private ensureBar() {
    if (this.listEl) return;
    const el = this.contentEl;
    el.empty();
    el.addClass("org-grid");
    const page = el.createDiv({ cls: "org-grid-page" });
    const bar = page.createDiv({ cls: "org-grid-bar" });
    const search = bar.createDiv({ cls: "org-grid-search" });
    setIcon(search.createSpan({ cls: "org-grid-search-icon" }), "search");
    const input = search.createEl("input", { attr: { type: "search", placeholder: "Search notes", enterkeyhint: "search" } });
    input.value = this.filter.text;
    input.addEventListener("input", () => {
      this.filter = { ...this.filter, text: input.value };
      if (this.typing !== null) window.clearTimeout(this.typing);
      this.typing = window.setTimeout(() => {
        this.typing = null;
        this.save();
        this.draw();
      }, 150);
    });
    this.chipsEl = bar.createDiv({ cls: "org-grid-chips" });
    this.listEl = page.createDiv({ cls: "org-grid-list" });
  }

  /** GRID-7: `app.loadLocalStorage` is Obsidian 1.8.7's; older apps use the browser's, and a failure shows everything */
  private loadFilter(): unknown {
    try {
      if (typeof this.app.loadLocalStorage === "function") return this.app.loadLocalStorage(FILTER_KEY);
      const raw = window.localStorage.getItem(FILTER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private save() {
    try {
      if (typeof this.app.saveLocalStorage === "function") this.app.saveLocalStorage(FILTER_KEY, this.filter);
      else window.localStorage.setItem(FILTER_KEY, JSON.stringify(this.filter));
    } catch {
      // the filter just isn't kept
    }
  }

  private toggle(kind: "tags" | "folders", value: string) {
    const list = this.filter[kind];
    this.filter = { ...this.filter, [kind]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    this.save();
    this.draw();
    this.contentEl.scrollTop = 0;
  }

  /** GRID-6, GRID-8: the hidden folders' chips, then every label, most used first */
  private drawChips() {
    const strip = this.chipsEl!;
    const scroll = strip.scrollLeft;
    strip.empty();
    const hidden = this.hidden();
    const chip = (text: string, icon: string | null, on: boolean, count: number | null, tap: () => void) => {
      const b = strip.createEl("button", { cls: "org-grid-chip", attr: { "aria-pressed": String(on) } });
      b.toggleClass("is-active", on);
      if (icon) setIcon(b.createSpan({ cls: "org-grid-chip-icon" }), icon);
      b.createSpan({ text });
      if (count !== null && !on) b.createSpan({ cls: "org-grid-chip-count", text: String(count) });
      b.addEventListener("click", tap);
    };
    for (const folder of hidden) {
      const count = this.cards.filter((c) => hiddenFolder(c.path, hidden) === folder).length;
      if (!count) continue;
      chip(folder, "folder", this.filter.folders.includes(folder), count, () => this.toggle("folders", folder));
    }
    for (const { tag, count } of gridLabels(this.cards, hidden)) chip(tag, null, this.filter.tags.includes(tag), count, () => this.toggle("tags", tag));
    strip.toggleClass("is-empty", !strip.childElementCount);
    strip.scrollLeft = scroll;
  }

  /** GRID-2: pinned cards, then the others, each in Keep-style columns */
  draw() {
    if (!this.listEl || !this.loaded) return;
    const el = this.contentEl;
    const scroll = this.scrollTo ?? el.scrollTop;
    this.scrollTo = null;
    this.drawChips();
    const list = this.listEl;
    list.empty();
    this.columns = gridColumns(el.clientWidth || 360);
    const shown = sortCards(filterCards(this.cards, this.filter, this.hidden()));
    if (!shown.length) {
      list.createDiv({ cls: "org-grid-empty", text: this.cards.length ? "No notes match." : "No org notes yet." });
      return;
    }
    const pinned = shown.filter((c) => c.pinned);
    const others = shown.filter((c) => !c.pinned);
    const section = (name: string | null, cards: GridCard[]) => {
      if (!cards.length) return;
      if (name) list.createDiv({ cls: "org-grid-section", text: name });
      const grid = list.createDiv({ cls: "org-grid-columns" });
      for (const column of masonry(cards.map(cardLines), this.columns)) {
        const col = grid.createDiv({ cls: "org-grid-column" });
        for (const i of column) this.drawCard(col, cards[i]);
      }
    };
    section(pinned.length ? "Pinned" : null, pinned);
    section(pinned.length ? "Others" : null, others);
    el.scrollTop = scroll;
  }

  /** GRID-3: a card: its title and opening lines, in its colour */
  private drawCard(parent: HTMLElement, card: GridCard) {
    const el = parent.createDiv({ cls: "org-grid-card", attr: { "data-path": card.path } });
    if (card.color) el.dataset.color = card.color;
    if (card.pinned) setIcon(el.createSpan({ cls: "org-grid-pin", attr: { "aria-label": "Pinned" } }), "pin");
    el.createDiv({ cls: "org-grid-title", text: card.title });
    if (card.preview.length) {
      const body = el.createDiv({ cls: "org-grid-text" });
      for (const line of card.preview) {
        const row = body.createDiv({ cls: `org-grid-line is-${line.kind}` });
        if (line.depth) row.style.paddingLeft = `${line.depth}em`;
        if (line.kind === "check" || line.kind === "checked") setIcon(row.createSpan({ cls: "org-grid-box" }), line.kind === "checked" ? "square-check" : "square");
        else if (line.kind === "item") row.createSpan({ cls: "org-grid-bullet", text: "•" });
        const text = row.createSpan({ cls: "org-grid-line-text" });
        if (line.text) renderInline(text, line.text, 0, line.text.length, parseInline(line.text));
        else text.setText(" ");
      }
      if (card.more) body.addClass("has-more");
    }
    onTap(el, () => this.openNote(card.path), () => new GridCardModal(this.app, this.plugin, card.path, () => this.render()).open());
  }

  /** GRID-1: a card opens its note in this tab, so going back returns to the grid */
  private openNote(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) void this.leaf.openFile(file);
  }
}

/** GRID-4..6: what holding a card offers: pin, colour and labels, each written to the note at once */
export class GridCardModal extends Modal {
  constructor(app: App, private plugin: OrgFlexPlugin, private path: string, private changed: () => void) {
    super(app);
  }

  private file(): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(this.path);
    return f instanceof TFile ? f : null;
  }

  private async edit(fn: (text: string) => string) {
    const file = this.file();
    if (!file) return;
    await this.app.vault.process(file, fn);
    await this.plugin.index.update(file.path);
    this.changed();
    await this.draw();
  }

  onOpen() {
    this.contentEl.addClass("org-grid-menu");
    void this.draw();
  }

  async draw() {
    const file = this.file();
    const { contentEl } = this;
    if (!file) return this.close();
    const text = await this.app.vault.read(file);
    const note = this.plugin.index.notes.get(file.path);
    const card = readCard({ ...(note ?? readNote(file.path, text)), text }, file.stat.mtime);
    this.setTitle(card.title);
    contentEl.empty();

    const pin = contentEl.createEl("button", { cls: "org-grid-menu-pin" });
    setIcon(pin.createSpan(), card.pinned ? "pin-off" : "pin");
    pin.createSpan({ text: card.pinned ? "Unpin" : "Pin" });
    pin.addEventListener("click", () => void this.edit((t) => setKeyword(t, "pinned", card.pinned ? null : "t")));

    contentEl.createDiv({ cls: "org-grid-menu-label", text: "Colour" });
    const swatches = contentEl.createDiv({ cls: "org-grid-swatches" });
    for (const color of [null, ...GRID_COLORS] as (GridColor | null)[]) {
      const s = swatches.createEl("button", { cls: "org-grid-swatch", attr: { "aria-label": color ?? "No colour", title: color ?? "No colour" } });
      if (color) s.dataset.color = color;
      else setIcon(s, "droplet-off");
      s.toggleClass("is-active", card.color === color);
      s.addEventListener("click", () => void this.edit((t) => setKeyword(t, "color", color)));
    }

    contentEl.createDiv({ cls: "org-grid-menu-label", text: "Labels" });
    const labels = contentEl.createDiv({ cls: "org-grid-menu-labels" });
    const all = [...new Set([...card.tags, ...gridLabels([...this.plugin.index.notes.values()].map((n) => readCard(n, 0)), []).map((l) => l.tag)])];
    for (const tag of all) {
      const on = card.tags.includes(tag);
      const b = labels.createEl("button", { cls: "org-grid-chip", attr: { "aria-pressed": String(on) } });
      b.toggleClass("is-active", on);
      if (on) setIcon(b.createSpan({ cls: "org-grid-chip-icon" }), "check");
      b.createSpan({ text: tag });
      b.addEventListener("click", () => void this.edit((t) => setFileTags(t, on ? card.tags.filter((x) => x !== tag) : [...card.tags, tag])));
    }
    const add = contentEl.createDiv({ cls: "org-grid-menu-add" });
    const input = add.createEl("input", { attr: { type: "text", placeholder: "New label", enterkeyhint: "done", autocapitalize: "off" } });
    const button = add.createEl("button", { text: "Add" });
    const submit = () => {
      const tag = cleanLabel(input.value);
      if (!tag) return void new Notice("A label is letters, digits, _ @ # or %.");
      void this.edit((t) => setFileTags(t, [...card.tags, tag]));
    };
    button.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
  }
}
