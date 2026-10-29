// AG-1..3: the agenda tab, over the org files at the vault's top level.

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type OrgFlexPlugin from "../main";
import { agendaFiles, AGENDA_DAYS, AGENDA_QUERY } from "../org/agenda";
import { agenda, parseQuery } from "../org/query";
import { OrgTask, parseTasks, toggleTaskInText } from "../org/tasks";
import { FLAVOUR } from "../flavour";
import { renderAgenda } from "./tasks-block";

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
    el.addClass("org-tasks", "org-agenda");
    renderAgenda(el, days, {
      toggle: (task) => void this.toggle(task),
      open: (task) => void this.plugin.openAt(this.app.workspace.getLeaf(false), task.path!, { line: task.line, top: true }),
    });
  }

  private async toggle(task: OrgTask) {
    const file = this.app.vault.getAbstractFileByPath(task.path!);
    if (!(file instanceof TFile)) return;
    const keywords = this.plugin.keywords();
    await this.app.vault.process(file, (text) => toggleTaskInText(text, task, keywords, this.plugin.taskLog()) ?? text);
  }
}
