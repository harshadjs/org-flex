// TL-1..7: the timeline tab, every node in the index newest first, with the
// attachments each one links to.

import { ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type OrgFlexPlugin from "../main";
import { onTap } from "../editor/state";
import { journalEntries } from "../org/journal";
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "../org/syntax";
import { ALL_KINDS, buildTimeline, cleanFilter, filterTimeline, type Timeline, type TimelineDay, type TimelineEntry, type TimelineFilter, type TimelineKind, timelineTags, untilEnd } from "../org/timeline";

export const TIMELINE_VIEW = "org-flex-timeline";

const p2 = (n: number) => String(n).padStart(2, "0");

/** TL-2: each kind's icon */
const KIND_ICON: Record<TimelineKind, string> = { journal: "calendar-days", note: "file-text", heading: "hash" };

/** TL-3: a file chip's icon for its kind */
function fileIcon(ext: string): string {
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio-lines";
  if (VIDEO_EXTENSIONS.includes(ext)) return "film";
  if (ext === "pdf") return "file-text";
  return "paperclip";
}

/** TL-5: where this device keeps the filter */
const FILTER_KEY = "org-flex-timeline-filter";

export class TimelineView extends ItemView {
  private timer: number | null = null;
  private typing: number | null = null;
  private full: Timeline = { days: [], unlinked: [] };
  private filter: TimelineFilter;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private tagsEl: HTMLElement | null = null;
  /** TL-3: loads a video when it comes near the screen */
  private videoObserver: IntersectionObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: OrgFlexPlugin) {
    super(leaf);
    this.filter = cleanFilter(this.loadFilter());
  }

  getViewType() {
    return TIMELINE_VIEW;
  }

  getDisplayText() {
    return "Timeline";
  }

  getIcon() {
    return "history";
  }

  async onOpen() {
    this.register(this.plugin.index.onChange(() => this.refreshSoon()));
    const vault = this.app.vault;
    this.registerEvent(vault.on("create", () => this.refreshSoon()));
    this.registerEvent(vault.on("delete", () => this.refreshSoon()));
    this.registerEvent(vault.on("rename", () => this.refreshSoon()));
    await this.plugin.index.ready;
    this.render();
  }

  async onClose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.typing !== null) window.clearTimeout(this.typing);
    this.videoObserver?.disconnect();
  }

  /** TL-3: give `video` its file once it is near the screen, so a long timeline doesn't fetch every video */
  private lazyVideo(video: HTMLVideoElement) {
    const load = (v: HTMLVideoElement) => {
      if (v.dataset.src && !v.getAttribute("src")) v.src = v.dataset.src;
    };
    if (typeof IntersectionObserver !== "function") return load(video);
    this.videoObserver ??= new IntersectionObserver((seen) => {
      for (const e of seen) {
        if (!e.isIntersecting) continue;
        load(e.target as HTMLVideoElement);
        this.videoObserver?.unobserve(e.target);
      }
    }, { rootMargin: "600px 0px" });
    this.videoObserver.observe(video);
  }

  private refreshSoon() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.render();
    }, 300);
  }

  /** TL-2, TL-3: build the timeline again from the index, then draw it as filtered */
  render() {
    const vault = this.app.vault;
    const files = vault.getFiles();
    const paths = files.map((f) => f.path);
    const ctime = new Map(files.map((f) => [f.path, f.stat.ctime]));
    const journal = new Set(journalEntries([...this.plugin.index.notes.keys()], this.plugin.settings.journalFolder).map((e) => e.path));
    this.full = buildTimeline(this.plugin.index.notes.values(), paths, (path) => new Date(ctime.get(path) ?? 0), journal);
    this.ensureBar();
    this.draw();
  }

  /** TL-5: the filter bar, made once so typing in it keeps its focus */
  private ensureBar() {
    if (this.listEl) return;
    const el = this.contentEl;
    el.empty();
    el.addClass("org-timeline");
    const page = el.createDiv({ cls: "org-timeline-page" });
    const bar = page.createDiv({ cls: "org-timeline-filters" });
    const search = bar.createDiv({ cls: "org-timeline-search" });
    setIcon(search.createSpan({ cls: "org-timeline-search-icon" }), "search");
    const input = search.createEl("input", { attr: { type: "search", placeholder: "Filter by title, tag or file", enterkeyhint: "search" } });
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
    const chips = bar.createDiv({ cls: "org-timeline-toggles" });
    const toggle = (label: string, icon: string, on: () => boolean, flip: () => void) => {
      const chip = chips.createEl("button", { cls: "org-timeline-toggle" });
      setIcon(chip.createSpan({ cls: "org-timeline-toggle-icon" }), icon);
      chip.createSpan({ text: label });
      const show = () => {
        chip.toggleClass("is-active", on());
        chip.setAttribute("aria-pressed", String(on()));
      };
      chip.addEventListener("click", () => {
        flip();
        show();
        this.save();
        this.draw();
      });
      show();
    };
    const kind = (k: TimelineKind) => () => {
      const kinds = this.filter.kinds.includes(k) ? this.filter.kinds.filter((x) => x !== k) : ALL_KINDS.filter((x) => x === k || this.filter.kinds.includes(x));
      this.filter = { ...this.filter, kinds };
    };
    toggle("Journal", KIND_ICON.journal, () => this.filter.kinds.includes("journal"), kind("journal"));
    toggle("Notes", KIND_ICON.note, () => this.filter.kinds.includes("note"), kind("note"));
    toggle("Headings", KIND_ICON.heading, () => this.filter.kinds.includes("heading"), kind("heading"));
    toggle("With attachments", "paperclip", () => this.filter.attachments, () => (this.filter = { ...this.filter, attachments: !this.filter.attachments }));
    this.untilChip(chips);
    this.countEl = chips.createDiv({ cls: "org-timeline-shown" });
    this.tagsEl = bar.createDiv({ cls: "org-timeline-tag-strip" });
    this.listEl = page.createDiv({ cls: "org-timeline-list" });
  }

  /** TL-5: `app.loadLocalStorage` is Obsidian 1.8.7's; older apps (minAppVersion) use the browser's, and a failure shows everything */
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

  /** TL-7: "Until" or "Until Oct 29", the system's date picker laid over it, and an × once a date is set */
  private untilChip(parent: HTMLElement) {
    const chip = parent.createDiv({ cls: "org-timeline-toggle org-timeline-until" });
    setIcon(chip.createSpan({ cls: "org-timeline-toggle-icon" }), "calendar-search");
    const label = chip.createSpan({ text: "Until" });
    const input = chip.createEl("input", { attr: { type: "date", "aria-label": "Show entries until" } });
    const clear = chip.createEl("button", { cls: "org-timeline-until-clear", attr: { "aria-label": "Any date" } });
    setIcon(clear, "x");
    const show = () => {
      const end = untilEnd(this.filter.until);
      input.value = this.filter.until;
      const day = end && new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
      const year = day && day.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {};
      label.setText(day ? `Until ${day.toLocaleDateString(undefined, { month: "short", day: "numeric", ...year })}` : "Until");
      chip.toggleClass("is-active", !!day);
      clear.toggleClass("is-hidden", !day);
    };
    const set = (until: string) => {
      this.filter = { ...this.filter, until };
      show();
      this.save();
      this.draw();
      this.contentEl.scrollTop = 0;
    };
    input.addEventListener("change", () => set(input.value));
    // a desktop browser opens its picker only from its own button, which is hidden
    input.addEventListener("click", () => {
      try {
        input.showPicker?.();
      } catch {
        // the field still takes typing
      }
    });
    clear.addEventListener("click", () => set(""));
    show();
  }

  /** TL-6: add `tag` to the filter, or take it out */
  private toggleTag(tag: string) {
    const tags = this.filter.tags.includes(tag) ? this.filter.tags.filter((t) => t !== tag) : [...this.filter.tags, tag];
    this.filter = { ...this.filter, tags };
    this.save();
    this.draw();
  }

  /** TL-6: the tags of what shows, chosen ones first, each a chip that toggles it */
  private drawTags(shown: Timeline) {
    const strip = this.tagsEl!;
    const scroll = strip.scrollLeft;
    strip.empty();
    const tags = timelineTags(shown, this.filter.tags);
    strip.toggleClass("is-empty", !tags.length);
    setIcon(strip.createSpan({ cls: "org-timeline-tag-strip-icon" }), "tags");
    for (const { tag, count } of tags) {
      const on = this.filter.tags.includes(tag);
      const chip = strip.createEl("button", { cls: "org-timeline-tag-chip", attr: { "aria-pressed": String(on) } });
      chip.toggleClass("is-active", on);
      chip.createSpan({ cls: "org-timeline-tag-name", text: tag });
      if (on) setIcon(chip.createSpan({ cls: "org-timeline-tag-x" }), "x");
      else chip.createSpan({ cls: "org-timeline-tag-count", text: String(count) });
      chip.addEventListener("click", () => this.toggleTag(tag));
    }
    strip.scrollLeft = scroll;
  }

  /** TL-5: draw the timeline as the filter leaves it */
  private draw() {
    const el = this.contentEl;
    const scroll = el.scrollTop;
    const list = this.listEl!;
    list.empty();
    const total = this.full.days.reduce((n, d) => n + d.entries.length, 0);
    const { days, unlinked } = filterTimeline(this.full, this.filter);
    const shown = days.reduce((n, d) => n + d.entries.length, 0);
    this.drawTags({ days, unlinked });
    this.countEl!.setText(shown === total ? `${total} ${total === 1 ? "entry" : "entries"}` : `${shown} of ${total} entries`);
    if (!days.length && !unlinked.length) {
      list.createDiv({ cls: "org-timeline-empty", text: total ? "Nothing matches the filter." : "No notes with an ID yet." });
      return;
    }
    // TL-2: a section per month, its header sticky while its days scroll by
    const months: { name: string; days: TimelineDay[] }[] = [];
    for (const day of days) {
      const name = day.date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      if (months[months.length - 1]?.name !== name) months.push({ name, days: [] });
      months[months.length - 1].days.push(day);
    }
    for (const month of months) {
      const section = list.createDiv({ cls: "org-timeline-month" });
      const header = section.createDiv({ cls: "org-timeline-month-header" });
      header.createSpan({ cls: "org-timeline-month-name", text: month.name });
      const count = month.days.reduce((n, d) => n + d.entries.length, 0);
      header.createSpan({ cls: "org-timeline-count", text: `${count} ${count === 1 ? "entry" : "entries"}` });
      for (const day of month.days) this.renderDay(section, day);
    }
    if (unlinked.length) {
      const section = list.createDiv({ cls: "org-timeline-month org-timeline-unlinked" });
      const header = section.createDiv({ cls: "org-timeline-month-header" });
      header.createSpan({ cls: "org-timeline-month-name", text: "Not linked" });
      header.createSpan({ cls: "org-timeline-count", text: `${unlinked.length} ${unlinked.length === 1 ? "file" : "files"}` });
      this.renderAttachments(section, unlinked);
    }
    el.scrollTop = scroll;
  }

  private renderDay(parent: HTMLElement, day: TimelineDay) {
    const row = parent.createDiv({ cls: "org-timeline-day" });
    const today = new Date();
    if (day.date.toDateString() === today.toDateString()) row.addClass("is-today");
    const badge = row.createDiv({ cls: "org-timeline-date" });
    badge.createDiv({ cls: "org-timeline-date-num", text: String(day.date.getDate()) });
    badge.createDiv({ cls: "org-timeline-date-wd", text: day.date.toLocaleDateString(undefined, { weekday: "short" }) });
    const list = row.createDiv({ cls: "org-timeline-rail" });
    for (const entry of day.entries) this.renderEntry(list, entry);
  }

  private renderEntry(parent: HTMLElement, entry: TimelineEntry) {
    const item = parent.createDiv({ cls: `org-timeline-entry is-${entry.kind}` });
    const head = item.createDiv({ cls: "org-timeline-head" });
    setIcon(head.createSpan({ cls: "org-timeline-icon" }), KIND_ICON[entry.kind]);
    const text = head.createDiv({ cls: "org-timeline-text" });
    text.createDiv({ cls: "org-timeline-title", text: entry.kind === "journal" ? "Journal" : entry.title });
    const meta = text.createDiv({ cls: "org-timeline-meta" });
    const t = entry.time;
    if (t.getHours() || t.getMinutes() || t.getSeconds()) meta.createSpan({ cls: "org-timeline-time", text: `${p2(t.getHours())}:${p2(t.getMinutes())}` });
    if (entry.note) meta.createSpan({ cls: "org-timeline-note", text: entry.note });
    if (!meta.childElementCount) meta.remove();
    onTap(head, () => void this.plugin.openAt(this.app.workspace.getLeaf(false), entry.path, { line: entry.line, top: true }),
      // ACT-16: holding an entry sets its ID's time; the timeline redraws with the index
      () => this.plugin.pickIdTime(entry.id, entry.kind === "journal" ? `the journal for ${entry.title}` : `“${entry.title}”`));
    if (entry.tags.length || entry.inherited.length) {
      // TL-6: its own tags, then the inherited ones fainter; a tap filters by it
      const row = item.createDiv({ cls: "org-timeline-tags" });
      for (const [tag, inherited] of [...entry.tags.map((t) => [t, false] as const), ...entry.inherited.map((t) => [t, true] as const)]) {
        const pill = row.createSpan({ cls: "org-timeline-tag", text: tag, attr: { title: inherited ? `${tag} (inherited)` : tag } });
        pill.toggleClass("is-inherited", inherited);
        pill.toggleClass("is-active", this.filter.tags.includes(tag));
        onTap(pill, () => this.toggleTag(tag));
      }
    }
    if (entry.attachments.length) this.renderAttachments(item, entry.attachments);
  }

  /** TL-3: images as rounded thumbnails, videos as players with their name under them, any other file as a chip with its kind's icon */
  private renderAttachments(parent: HTMLElement, paths: string[]) {
    const images = parent.createDiv({ cls: "org-timeline-thumbs" });
    const videos = parent.createDiv({ cls: "org-timeline-videos" });
    const chips = parent.createDiv({ cls: "org-timeline-chips" });
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const ext = file.extension.toLowerCase();
      let item: HTMLElement;
      if (IMAGE_EXTENSIONS.includes(ext)) {
        item = images.createEl("img", { cls: "org-timeline-thumb", attr: { src: this.app.vault.getResourcePath(file), alt: file.name, title: file.name, loading: "lazy" } });
      } else if (VIDEO_EXTENSIONS.includes(ext)) {
        // `#t=0.1` makes a phone draw the first frame instead of a black box
        const box = videos.createDiv({ cls: "org-timeline-video" });
        const video = box.createEl("video", { attr: { controls: "", preload: "metadata", playsinline: "" } });
        video.dataset.src = `${this.app.vault.getResourcePath(file)}#t=0.1`;
        this.lazyVideo(video);
        item = box.createDiv({ cls: "org-timeline-video-name", attr: { title: file.name } });
        setIcon(item.createSpan({ cls: "org-timeline-chip-icon" }), "film");
        item.createSpan({ cls: "org-timeline-chip-name", text: file.name });
      } else {
        item = chips.createDiv({ cls: "org-timeline-chip", attr: { title: file.name } });
        setIcon(item.createSpan({ cls: "org-timeline-chip-icon" }), fileIcon(ext));
        item.createSpan({ cls: "org-timeline-chip-name", text: file.name });
      }
      onTap(item, () => void this.app.workspace.getLeaf(false).openFile(file));
    }
    if (!images.childElementCount) images.remove();
    if (!videos.childElementCount) videos.remove();
    if (!chips.childElementCount) chips.remove();
  }
}
