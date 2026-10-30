// TL-1..4: the timeline tab, every node in the index newest first, with the
// attachments each one links to.

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type OrgFlexPlugin from "../main";
import { onTap } from "../editor/state";
import { IMAGE_EXTENSIONS } from "../org/syntax";
import { buildTimeline, type TimelineEntry } from "../org/timeline";

export const TIMELINE_VIEW = "org-flex-timeline";

const p2 = (n: number) => String(n).padStart(2, "0");

export class TimelineView extends ItemView {
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: OrgFlexPlugin) {
    super(leaf);
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
  }

  private refreshSoon() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.render();
    }, 300);
  }

  render() {
    const vault = this.app.vault;
    const files = vault.getFiles();
    const ctime = new Map(files.map((f) => [f.path, f.stat.ctime]));
    const { days, unlinked } = buildTimeline(this.plugin.index.notes.values(), files.map((f) => f.path), (path) => new Date(ctime.get(path) ?? 0));
    const scroll = this.contentEl.scrollTop;
    const el = this.contentEl;
    el.empty();
    el.addClass("org-timeline");
    let month = "";
    for (const day of days) {
      const m = day.date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      if (m !== month) {
        el.createDiv({ cls: "org-timeline-month", text: m });
        month = m;
      }
      el.createDiv({ cls: "org-timeline-day", text: day.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) });
      const list = el.createEl("ul", { cls: "org-timeline-entries" });
      for (const entry of day.entries) this.renderEntry(list.createEl("li", { cls: "org-timeline-entry" }), entry);
    }
    if (unlinked.length) {
      el.createDiv({ cls: "org-timeline-month", text: "Not linked" });
      this.renderAttachments(el, unlinked);
    }
    if (!days.length && !unlinked.length) el.createDiv({ cls: "org-timeline-empty", text: "No notes with an ID yet." });
    el.scrollTop = scroll;
  }

  private renderEntry(li: HTMLElement, entry: TimelineEntry) {
    const row = li.createDiv({ cls: "org-timeline-row" });
    const t = entry.time;
    if (t.getHours() || t.getMinutes() || t.getSeconds()) row.createSpan({ cls: "org-timeline-time", text: `${p2(t.getHours())}:${p2(t.getMinutes())}` });
    const title = row.createSpan({ cls: "org-timeline-title", text: entry.title });
    onTap(title, () => void this.plugin.openAt(this.app.workspace.getLeaf(false), entry.path, { line: entry.line, top: true }));
    if (entry.note) row.createSpan({ cls: "org-timeline-note", text: entry.note });
    if (entry.attachments.length) this.renderAttachments(li, entry.attachments);
  }

  /** TL-3: images as thumbnails, any other file as 📎 and its name */
  private renderAttachments(parent: HTMLElement, paths: string[]) {
    const box = parent.createDiv({ cls: "org-timeline-attachments" });
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      let item: HTMLElement;
      if (IMAGE_EXTENSIONS.includes(file.extension.toLowerCase())) {
        item = box.createEl("img", { cls: "org-timeline-thumb", attr: { src: this.app.vault.getResourcePath(file), alt: file.name, loading: "lazy" } });
      } else {
        item = box.createSpan({ cls: "org-timeline-file", text: `📎 ${file.name}` });
      }
      onTap(item, () => void this.app.workspace.getLeaf(false).openFile(file));
    }
  }
}
