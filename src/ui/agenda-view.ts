// AG-1..4: the agenda tab, over the org files at the vault's top level.

import { ItemView, moment, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type OrgFlexPlugin from "../main";
import { onTap } from "../editor/state";
import { agendaFiles, AGENDA_DAYS, AGENDA_QUERY, chosenDay, dayOffset, monthGrid, monthStart, relativeDay, weekSpanStart } from "../org/agenda";
import { drawModes, drawMonthGrid, drawStepper, monthName } from "./month-grid";
import { FEATURES } from "../features";
import { agenda, type AgendaDay, type AgendaItem, overdueLabel, parseQuery } from "../org/query";
import { OrgTask, parseTasks, toggleTaskInText } from "../org/tasks";
import { FLAVOUR } from "../flavour";
import { linkText } from "./tasks-block";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const AGENDA_VIEW = "org-flex-agenda";

/** AG-6: where this device keeps the Week / Month choice */
const MODE_KEY = "org-flex-agenda-mode";

type Mode = "week" | "month";


export class AgendaView extends ItemView {
  private timer: number | null = null;
  private tasks: OrgTask[] = [];
  private mode: Mode = "week";
  /** AG-5: weeks or months from today's */
  private offset = 0;
  /** AG-6: the month view's chosen day */
  private chosen: Date | null = null;

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
    this.mode = this.loadMode();
    await this.render();
  }

  /** AG-5: back to today's span, as opening the agenda again does */
  async showToday() {
    this.offset = 0;
    this.chosen = null;
    await this.render();
  }

  private loadMode(): Mode {
    try {
      const saved = typeof this.app.loadLocalStorage === "function" ? this.app.loadLocalStorage(MODE_KEY) : window.localStorage.getItem(MODE_KEY);
      return saved === "month" ? "month" : "week";
    } catch {
      return "week";
    }
  }

  private saveMode() {
    try {
      if (typeof this.app.saveLocalStorage === "function") this.app.saveLocalStorage(MODE_KEY, this.mode);
      else window.localStorage.setItem(MODE_KEY, this.mode);
    } catch {
      // the choice just isn't kept
    }
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
    this.tasks = tasks;
    this.draw(true);
  }

  /** AG-2, AG-5, AG-6: the moving buttons, then the week or the month as the tasks read last fall on it */
  private draw(keepScroll: boolean) {
    const el = this.contentEl;
    const scroll = el.scrollTop;
    el.empty();
    el.addClass("org-agenda");
    const page = el.createDiv({ cls: "org-agenda-page" });
    const now = new Date();
    const locale = moment.locale();
    const ctx = { todoKeywords: FLAVOUR.todoKeywords, doneKeywords: FLAVOUR.doneKeywords, defaultPriority: FLAVOUR.defaultPriority };
    const query = parseQuery(AGENDA_QUERY);
    this.drawNav(page);
    if (this.mode === "week") {
      const start = weekSpanStart(now, this.offset);
      this.drawWeek(page, agenda(query, this.tasks, now, AGENDA_DAYS, ctx, start), now, locale);
    } else {
      const month = monthStart(now, this.offset);
      const grid = monthGrid(month);
      this.drawMonth(page, month, grid, agenda(query, this.tasks, now, grid.length, ctx, grid[0]), now, locale);
    }
    el.scrollTop = keepScroll ? scroll : 0;
  }

  /** AG-5, AG-6: ‹ ›, Today while elsewhere, and the Week / Month switch */
  private drawNav(page: HTMLElement) {
    const nav = page.createDiv({ cls: "org-month-nav" });
    drawStepper(nav, this.mode, this.offset, (offset) => this.move(offset));
    drawModes(nav, [["week", "Week"], ["month", "Month"]] as const, this.mode, (mode) => {
      this.mode = mode;
      this.saveMode();
      this.move(0);
    });
  }

  private move(offset: number) {
    this.offset = offset;
    this.chosen = null;
    this.draw(false);
  }

  /** AG-4: a header with the week and its counts, then a section per day, each with its date badge */
  private drawWeek(page: HTMLElement, days: AgendaDay[], now: Date, locale: string) {
    const dated = days.filter((d) => d.date);
    const fmt = (d: Date) => d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    this.header(page, `${fmt(dated[0]?.date ?? now)} – ${fmt(dated[dated.length - 1]?.date ?? now)}`, dated, days, locale);
    for (const day of days) this.renderDay(page, day, now, locale);
  }

  private header(page: HTMLElement, range: string, dated: AgendaDay[], days: AgendaDay[], locale: string) {
    const overdue = days.find((d) => !d.date)?.items.length ?? 0;
    const planned = dated.reduce((n, d) => n + d.items.length, 0);
    const header = page.createDiv({ cls: "org-agenda-header" });
    header.createDiv({ cls: "org-agenda-range", text: range });
    const counts = header.createDiv({ cls: "org-agenda-counts" });
    counts.createSpan({ text: plural(planned, "item", "items") });
    if (overdue) counts.createSpan({ cls: "org-agenda-counts-overdue", text: `${overdue} ${overdueLabel(locale).toLowerCase()}` });
  }

  /** AG-6: the month's grid, the chosen day's items under it, then Overdue when the grid holds today */
  private drawMonth(page: HTMLElement, month: Date, grid: Date[], days: AgendaDay[], now: Date, locale: string) {
    const byDay = new Map(days.filter((d) => d.date).map((d) => [d.date!.toDateString(), d]));
    const inMonth = (d: Date) => d.getMonth() === month.getMonth();
    this.header(page, monthName(month, locale), days.filter((d) => d.date && inMonth(d.date)), days, locale);
    const chosen = chosenDay(this.chosen, month, now);
    drawMonthGrid(page, {
      month, now, chosen, locale,
      titles: (date) => (byDay.get(date.toDateString())?.items ?? []).map((i) => linkText(i.task.title)),
      choose: (date) => {
        this.chosen = date;
        this.draw(true);
      },
    });
    this.renderDay(page, byDay.get(chosen.toDateString()) ?? { date: chosen, items: [] }, now, locale, "Add");
    const overdue = days.find((d) => !d.date);
    if (overdue) this.renderDay(page, overdue, now, locale);
  }

  private renderDay(parent: HTMLElement, day: AgendaDay, now: Date, locale: string, addLabel?: string) {
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
    // AG-7: plan on this day
    const captureOn = FEATURES.find((f) => f.captureOn)?.captureOn;
    if (day.date && captureOn) {
      const date = day.date;
      const add = head.createEl("button", { cls: "org-agenda-add clickable-icon", attr: { "aria-label": `Plan on ${date.toLocaleDateString(locale, { month: "long", day: "numeric" })}` } });
      setIcon(add.createSpan({ cls: "org-agenda-add-icon" }), "plus");
      if (addLabel) add.createSpan({ text: addLabel });
      onTap(add, () => captureOn(this.plugin, date));
    }
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
