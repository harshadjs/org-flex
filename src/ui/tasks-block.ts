// TASK-1..5: the ```orgmode-tasks code block in Markdown notes.

import { MarkdownPostProcessorContext, MarkdownRenderChild, moment, parseYaml, TFile } from "obsidian";
import type OrgFlexPlugin from "../main";
import { parseTasks, OrgTask, taskBlockConfig, toggleTaskInText } from "../org/tasks";
import { agenda, type AgendaDay, type AgendaItem, overdueLabel, parseQuery, runQuery } from "../org/query";
import { onTap } from "../editor/state";
import { FLAVOUR } from "../flavour";

class TaskList extends MarkdownRenderChild {
  constructor(el: HTMLElement, private plugin: OrgFlexPlugin, private source: string, private sourcePath: string) {
    super(el);
  }

  onload() {
    void this.render();
    this.registerEvent(this.plugin.app.vault.on("modify", (file) => {
      if (file.path === this.file()?.path) void this.render();
    }));
  }

  private config(): { filepath: string; query: string } {
    return taskBlockConfig(parseYaml(this.source));
  }

  private file(): TFile | null {
    try {
      const { filepath } = this.config();
      const app = this.plugin.app;
      const direct = app.vault.getAbstractFileByPath(filepath);
      if (direct instanceof TFile) return direct;
      return app.metadataCache.getFirstLinkpathDest(filepath, this.sourcePath);
    } catch {
      return null;
    }
  }

  private async render() {
    const el = this.containerEl;
    el.empty();
    el.addClass("org-tasks");
    try {
      const { filepath, query: source } = this.config();
      const file = this.file();
      if (!file) throw new Error(`File not found: ${filepath}`);
      const keywords = this.plugin.keywords();
      const tasks = parseTasks(await this.plugin.app.vault.read(file), keywords);
      const query = parseQuery(source);
      const ctx = { todoKeywords: FLAVOUR.todoKeywords, doneKeywords: FLAVOUR.doneKeywords, defaultPriority: FLAVOUR.defaultPriority };
      const now = new Date();
      const toggle = (task: OrgTask) => void this.toggle(file, task);
      if (query.agendaDays !== null) {
        renderAgenda(el, agenda(query, tasks, now, query.agendaDays, ctx), { toggle });
      } else {
        renderTasks(el, runQuery(query, tasks, now, ctx).map((task) => ({ task, kind: null, time: null, note: "" })), { toggle });
      }
    } catch (e) {
      el.createDiv({ cls: "org-tasks-error", text: `orgmode-tasks: ${(e as Error).message}` });
    }
  }

  private async toggle(file: TFile, task: OrgTask) {
    const keywords = this.plugin.keywords();
    // TASK-3: vault.process, so edits made meanwhile aren't lost
    await this.plugin.app.vault.process(file, (text) => toggleTaskInText(text, task, keywords, this.plugin.taskLog()) ?? text);
  }
}

export interface TaskListActions {
  /** TASK-3: the checkbox was ticked */
  toggle(task: OrgTask): void;
  /** AG-3: the task's title was tapped */
  open?(task: OrgTask): void;
}

type ListItem = Omit<AgendaItem, "kind"> & { kind: AgendaItem["kind"] | null };

/** TASK-1, AG-2: tasks as a checklist. A timestamp on a heading without a keyword (a birthday) gets no checkbox. */
export function renderTasks(parent: HTMLElement, items: ListItem[], actions: TaskListActions) {
  const ul = parent.createEl("ul", { cls: "contains-task-list org-tasks-list" });
  const locale = moment.locale();
  for (const item of items) {
    const { task } = item;
    const li = ul.createEl("li", { cls: "task-list-item" + (task.done ? " is-checked" : "") });
    if (item.kind !== "timestamp" || task.keyword) {
      const box = li.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      box.checked = task.done;
      box.addEventListener("click", (e) => {
        e.preventDefault();
        actions.toggle(task);
      });
    } else {
      li.addClass("org-tasks-event");
    }
    if (item.time) li.createSpan({ cls: "org-tasks-time", text: item.time });
    if (task.keyword) li.createSpan({ cls: `org-keyword ${task.done ? "org-keyword-done" : "org-keyword-todo"}`, text: task.keyword });
    if (task.priority) li.createSpan({ cls: "org-priority", text: `[#${task.priority}]` });
    const title = li.createSpan({ cls: "org-tasks-title", text: linkText(task.title) });
    if (item.note) li.createSpan({ cls: "org-tasks-note", text: item.note });
    const open = actions.open;
    if (open) {
      title.addClass("org-tasks-open");
      onTap(title, () => open(task));
    }
    // a plain list shows both dates; an agenda item says why it is there
    const dates = item.kind === null ? (["scheduled", "deadline"] as const) : item.kind === "timestamp" ? [] : [item.kind];
    for (const kind of dates) {
      const date = task[kind];
      if (date) li.createSpan({ cls: "org-tasks-date", text: `${kind} ${date.toLocaleDateString(locale)}` });
    }
  }
}

/** TASK-5, AG-2: the agenda's days, each a heading over its tasks; overdue first. */
export function renderAgenda(el: HTMLElement, days: AgendaDay[], actions: TaskListActions) {
  const locale = moment.locale();
  for (const day of days) {
    const label = day.date
      ? day.date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })
      : overdueLabel(locale);
    el.createDiv({ cls: "org-tasks-day" + (day.date ? "" : " is-overdue"), text: label });
    renderTasks(el, day.items, actions);
  }
}

/** `[[id:x][Name]]` as `Name`, `[[target]]` as `target`. */
function linkText(title: string): string {
  return title.replace(/\[\[([^\]]*)\](?:\[([^\]]*)\])?\]/g, (_, target: string, desc?: string) => desc ?? target);
}

export function registerTaskBlocks(plugin: OrgFlexPlugin) {
  plugin.registerMarkdownCodeBlockProcessor("orgmode-tasks", (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    ctx.addChild(new TaskList(el, plugin, source, ctx.sourcePath));
  });
}
