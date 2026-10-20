// The settings tab (§12).

import { App, getIcon, PluginSettingTab, setIcon, Setting } from "obsidian";
import type OrgFlexPlugin from "../main";
import { BUTTONS, parseKeywordList } from "../settings";
import type { VisibilityLevel } from "../org/folding";

export class OrgFlexSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: OrgFlexPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName("Tasks").setHeading();
    new Setting(containerEl)
      .setName("TODO keywords")
      .setDesc("Keywords of open tasks, separated by commas or new lines. The first one is used when cycling.")
      .addTextArea((t) => t.setValue(settings.todoKeywords.join(", ")).onChange(async (v) => {
        settings.todoKeywords = parseKeywordList(v);
        await save();
      }));
    new Setting(containerEl)
      .setName("DONE keywords")
      .setDesc("Keywords of closed tasks. The first one is used when cycling.")
      .addTextArea((t) => t.setValue(settings.doneKeywords.join(", ")).onChange(async (v) => {
        settings.doneKeywords = parseKeywordList(v);
        await save();
      }));
    new Setting(containerEl)
      .setName("Default priority")
      .setDesc("Used when sorting tasks that have no priority.")
      .addText((t) => t.setValue(settings.defaultPriority).onChange(async (v) => {
        settings.defaultPriority = v.trim().toUpperCase().slice(0, 1) || "B";
        await save();
      }));

    new Setting(containerEl).setName("Editor").setHeading();
    new Setting(containerEl)
      .setName("Hide leading stars")
      .setDesc("Hide the stars of headings unless the cursor is on them.")
      .addToggle((t) => t.setValue(settings.hideStars).onChange(async (v) => {
        settings.hideStars = v;
        await save();
      }));
    new Setting(containerEl)
      .setName("Default fold level")
      .setDesc("The visibility a file opens with.")
      .addDropdown((d) => d
        .addOptions({ foldall: "Fold all", outline: "Outline", expandall: "Expand all" })
        .setValue(settings.defaultFoldLevel)
        .onChange(async (v) => {
          settings.defaultFoldLevel = v as VisibilityLevel;
          await save();
        }));
    new Setting(containerEl)
      .setName("Fold properties drawer by default")
      .setDesc("Property drawers stay folded at every visibility level, and the front matter's Properties start collapsed.")
      .addToggle((t) => t.setValue(settings.foldPropertyDrawers).onChange(async (v) => {
        settings.foldPropertyDrawers = v;
        await save();
      }));
    new Setting(containerEl)
      .setName("Front matter panel")
      .setDesc("Show the drawer and #+ lines at the top of a file as a title and a list of properties.")
      .addToggle((t) => t.setValue(settings.frontMatterPanel).onChange(async (v) => {
        settings.frontMatterPanel = v;
        await save();
      }));
    new Setting(containerEl)
      .setName("Backlinks")
      .setDesc("Show linked and unlinked mentions at the end of every org note.")
      .addToggle((t) => t.setValue(settings.backlinks).onChange(async (v) => {
        settings.backlinks = v;
        await save();
      }));

    new Setting(containerEl).setName("Journal").setHeading();
    new Setting(containerEl)
      .setName("Journal folder")
      .setDesc("Daily files go to <folder>/YYYY/MM/YYYY-MM-DD.org. Empty means the vault root.")
      .addText((t) => t.setValue(settings.journalFolder).onChange(async (v) => {
        settings.journalFolder = v;
        await save();
      }));

    new Setting(containerEl).setName("Shortcut bar").setHeading();
    new Setting(containerEl)
      .setName("Show the shortcut bar")
      .addToggle((t) => t.setValue(settings.showShortcutBar).onChange(async (v) => {
        settings.showShortcutBar = v;
        await save();
      }));
    for (const def of BUTTONS) {
      const setting = new Setting(containerEl).setName(def.name);
      const preview = setting.controlEl.createSpan({ cls: "org-icon-preview" });
      const showIcon = () => {
        preview.empty();
        setIcon(preview, this.plugin.buttonIcon(def));
      };
      if (def.id !== "visibility") {
        setting.addText((t) => t
          .setPlaceholder(def.icon)
          .setValue(settings.shortcutCustomIcons[def.id] ?? "")
          .onChange(async (v) => {
            const name = v.trim();
            if (name) settings.shortcutCustomIcons[def.id] = name;
            else delete settings.shortcutCustomIcons[def.id];
            t.inputEl.toggleClass("org-icon-invalid", Boolean(name) && !getIcon(name));
            showIcon();
            await save();
          }));
      }
      setting.controlEl.prepend(preview);
      showIcon();
      setting.addToggle((t) => t.setValue(settings.shortcutBarButtons.includes(def.id)).onChange(async (v) => {
        const on = new Set(settings.shortcutBarButtons);
        if (v) on.add(def.id);
        else on.delete(def.id);
        settings.shortcutBarButtons = BUTTONS.map((b) => b.id).filter((id) => on.has(id));
        await save();
      }));
    }
  }
}
