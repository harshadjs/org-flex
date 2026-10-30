// AG-1..4: the agenda tab, over the org files at the vault's top level.

import { ItemView, moment, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type OrgFlexPlugin from "../main";
import { onTap } from "../editor/state";
import { agendaFiles, AGENDA_DAYS, AGENDA_QUERY, dayOffset, relativeDay } from "../org/agenda";
import { agenda, type AgendaDay, type AgendaItem, overdueLabel, parseQuery } from "../org/query";
import { OrgTask, parseTasks, toggleTaskInText } from "../org/tasks";
import { FLAVOUR } from "../flavour";
import { linkText } from "./tasks-block";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const AGENDA_VIEW = "org-flex-agenda";

export class AgendaView extends ItemView {
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: OrgFlexPlugin) {
    super(leaf);
  }

  getViewType() {
    return AGENDA_VIEW;
  }

  getDisplayText() {
    return "Agenda";
  }

  getIcon() {
    return "calendar-range";
  }

  async onOpen() {
    const vault = this.app.vault;
    const changed = (file: { path: string }) => {
      if (agendaFiles([file.path]).length) this.refreshSoon();
    };
    this.registerEvent(vault.on("modify", changed));
    this.registerEvent(vault.on("create", changed));
    this.registerEvent(vault.on("delete", changed));
    this.registerEvent(vault.on("rename", (file, old) => {
      changed(file);
      changed({ path: old });
    }));
    await this.render();
  }

  async onClose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  private refreshSoon() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.render();
    }, 300);
  }

  async render() {
    const keywords = this.plugin.keywords();
    const vault = this.app.vault;
    const files = agendaFiles(vault.getFiles().map((f) => f.path));
    const tasks: OrgTask[] = [];
    for (const path of files) {
      const file = vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      for (const task of parseTasks(await vault.cachedRead(file), keywords)) tasks.push({ ...task, path });
    }
    const ctx = { todoKeywords: FLAVOUR.todoKeywords, doneKeywords: FLAVOUR.doneKeywords, defaultPriority: FLAVOUR.defaultPriority };
    const days = agenda(parseQuery(AGENDA_QUERY), tasks, new Date(), AGENDA_DAYS, ctx);
    const el = this.contentEl;
    el.empty();
    el.addClass("org-agenda");
    this.draw(el.createDiv({ cls: "org-agenda-page" }), days, new Date());
  }

  /** AG-4: a header with the week and its counts, then a section per day, each with its date badge */
  private draw(page: HTMLElement, days: AgendaDay[], now: Date) {
    const locale = moment.locale();
    const dated = days.filter((d) => d.date);
    const overdue = days.find((d) => !d.date)?.items.length ?? 0;
    const planned = dated.reduce((n, d) => n + d.items.length, 0);
    const header = page.createDiv({ cls: "org-agenda-header" });
    const first = dated[0]?.date ?? now;
    const last = dated[dated.length - 1]?.date ?? now;
    const fmt = (d: Date) => d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    header.createDiv({ cls: "org-agenda-range", text: `${fmt(first)} – ${fmt(last)}` });
    const counts = header.createDiv({ cls: "org-agenda-counts" });
    counts.createSpan({ text: plural(planned, "item", "items") });
    if (overdue) counts.createSpan({ cls: "org-agenda-counts-overdue", text: `${overdue} ${overdueLabel(locale).toLowerCase()}` });
    for (const day of days) this.renderDay(page, day, now, locale);
  }

  private renderDay(parent: HTMLElement, day: AgendaDay, now: Date, locale: string) {
    const offset = day.date ? dayOffset(day.date, now) : null;
    const row = parent.createDiv({ cls: "org-agenda-day" });
    if (!day.date) row.addClass("is-overdue");
    if (offset === 0) row.addClass("is-today");
    if (!day.items.length) row.addClass("is-empty");
    const badge = row.createDiv({ cls: "org-agenda-date" });
    if (day.date) {
      badge.createDiv({ cls: "org-agenda-date-num", text: String(day.date.getDate()) });
      badge.createDiv({ cls: "org-agenda-date-wd", text: day.date.toLocaleDateString(locale, { weekday: "short" }) });
    } else {
      setIcon(badge.createDiv({ cls: "org-agenda-date-icon" }), "alarm-clock");
    }
    const body = row.createDiv({ cls: "org-agenda-body" });
    const head = body.createDiv({ cls: "org-agenda-day-head" });
    if (day.date) {
      const near = offset === 0 || offset === 1;
      const name = near ? relativeDay(offset!, locale) : day.date.toLocaleDateString(locale, { weekday: "long" });
      head.createSpan({ cls: "org-agenda-day-name", text: name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) });
      head.createSpan({ cls: "org-agenda-day-date", text: day.date.toLocaleDateString(locale, near ? { weekday: "long", month: "long", day: "numeric" } : { month: "long", day: "numeric" }) });
    } else {
      head.createSpan({ cls: "org-agenda-day-name", text: overdueLabel(locale) });
    }
    if (day.items.length) head.createSpan({ cls: "org-agenda-count", text: String(day.items.length) });
    else body.createDiv({ cls: "org-agenda-nothing", text: "Nothing planned" });
    for (const item of day.items) this.renderItem(body, item, day.date === null, now, locale);
  }

  /** AG-4: the time (or how late), a checkbox, the title with its keyword and priority, then why it is here and its file */
  private renderItem(parent: HTMLElement, item: AgendaItem, late: boolean, now: Date, locale: string) {
    const { task } = item;
    const row = parent.createDiv({ cls: `org-agenda-item is-${item.kind}` });
    row.createDiv({ cls: "org-agenda-time", text: item.time ?? "" });
    if (item.kind !== "timestamp" || task.keyword) {
      const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox org-agenda-check" });
      box.checked = task.done;
      box.addEventListener("click", (e) => {
        e.preventDefault();
        row.addClass("is-checked");
        void this.toggle(task);
      });
    } else {
      setIcon(row.createDiv({ cls: "org-agenda-event-icon" }), "calendar-heart");
    }
    const main = row.createDiv({ cls: "org-agenda-main" });
    const title = main.createDiv({ cls: "org-agenda-title" });
    if (task.keyword) title.createSpan({ cls: `org-agenda-keyword ${task.done ? "is-done" : "is-todo"}`, text: task.keyword });
    if (task.priority) title.createSpan({ cls: `org-agenda-priority is-${task.priority.toLowerCase()}`, text: task.priority });
    title.createSpan({ cls: "org-agenda-title-text", text: linkText(task.title) });
    if (item.note) title.createSpan({ cls: "org-agenda-note", text: item.note });
    const meta = main.createDiv({ cls: "org-agenda-meta" });
    const date = item.kind === "timestamp" ? null : task[item.kind];
    if (item.kind === "deadline" || late) {
      const chip = meta.createSpan({ cls: `org-agenda-why is-${item.kind}` });
      setIcon(chip.createSpan({ cls: "org-agenda-why-icon" }), item.kind === "deadline" ? "flag" : "clock");
      const when = late && date ? ` · ${relativeDay(dayOffset(date, now), locale)}` : "";
      chip.createSpan({ text: (item.kind === "deadline" ? "Deadline" : "Scheduled") + when });
    }
    if (task.path) meta.createSpan({ cls: "org-agenda-file", text: task.path.replace(/\.org$/i, "") });
    onTap(main, () => void this.plugin.openAt(this.app.workspace.getLeaf(false), task.path!, { line: task.line, top: true }));
  }

  private async toggle(task: OrgTask) {
    const file = this.app.vault.getAbstractFileByPath(task.path!);
    if (!(file instanceof TFile)) return;
    const keywords = this.plugin.keywords();
    await this.app.vault.process(file, (text) => toggleTaskInText(text, task, keywords, this.plugin.taskLog()) ?? text);
  }
}
