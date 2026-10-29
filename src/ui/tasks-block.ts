// TASK-1..5: the ```orgmode-tasks code block in Markdown notes.

import { MarkdownPostProcessorContext, MarkdownRenderChild, moment, parseYaml, TFile } from "obsidian";
import type OrgFlexPlugin from "../main";
import { parseTasks, OrgTask, taskBlockConfig, toggleTaskInText } from "../org/tasks";
import { agenda, overdueLabel, parseQuery, runQuery } from "../org/query";
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
      if (query.agendaDays !== null) {
        const locale = moment.locale();
        for (const day of agenda(query, tasks, now, query.agendaDays, ctx)) {
          const label = day.date
            ? day.date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })
            : overdueLabel(locale);
          el.createDiv({ cls: "org-tasks-day" + (day.date ? "" : " is-overdue"), text: label });
          this.list(el, file, day.tasks);
        }
      } else {
        this.list(el, file, runQuery(query, tasks, now, ctx));
      }
    } catch (e) {
      el.createDiv({ cls: "org-tasks-error", text: `orgmode-tasks: ${(e as Error).message}` });
    }
  }

  private list(parent: HTMLElement, file: TFile, tasks: OrgTask[]) {
    const ul = parent.createEl("ul", { cls: "contains-task-list org-tasks-list" });
    for (const task of tasks) {
      const li = ul.createEl("li", { cls: "task-list-item" + (task.done ? " is-checked" : "") });
      const box = li.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      box.checked = task.done;
      box.addEventListener("click", (e) => {
        e.preventDefault();
        void this.toggle(file, task);
      });
      if (task.keyword) li.createSpan({ cls: `org-keyword ${task.done ? "org-keyword-done" : "org-keyword-todo"}`, text: task.keyword });
      if (task.priority) li.createSpan({ cls: "org-priority", text: `[#${task.priority}]` });
      li.createSpan({ cls: "org-tasks-title", text: task.title });
      for (const [name, date] of [["SCHEDULED", task.scheduled], ["DEADLINE", task.deadline]] as const) {
        if (date) li.createSpan({ cls: "org-tasks-date", text: `${name.toLowerCase()} ${date.toLocaleDateString(moment.locale())}` });
      }
    }
  }

  private async toggle(file: TFile, task: OrgTask) {
    const keywords = this.plugin.keywords();
    // TASK-3: vault.process, so edits made meanwhile aren't lost
    await this.plugin.app.vault.process(file, (text) => toggleTaskInText(text, task, keywords, this.plugin.taskLog()) ?? text);
  }
}

export function registerTaskBlocks(plugin: OrgFlexPlugin) {
  plugin.registerMarkdownCodeBlockProcessor("orgmode-tasks", (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    ctx.addChild(new TaskList(el, plugin, source, ctx.sourcePath));
  });
}
