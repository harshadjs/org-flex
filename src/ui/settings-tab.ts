// The settings tab (§12): only what differs between vaults and devices.
// Workflow choices are in the flavour (src/flavour.ts, §12a).

import { App, getIcon, PluginSettingTab, setIcon, Setting } from "obsidian";
import type OrgFlexPlugin from "../main";
import { BUTTONS, barButtons, moveButton, toggleButton } from "../settings";

export class OrgFlexSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: OrgFlexPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName("Journal").setHeading();
    new Setting(containerEl)
      .setName("Journal folder")
      .setDesc("Daily files go to <folder>/YYYY/MM/YYYY-MM-DD.org. Empty means the vault root.")
      .addText((t) => t.setValue(settings.journalFolder).onChange(async (v) => {
        settings.journalFolder = v;
        await save();
      }));

    new Setting(containerEl).setName("Capture").setHeading();
    new Setting(containerEl)
      .setName("Inbox file")
      .setDesc("Captured TODOs go at the end of this file, which is created when missing. \".org\" is added when left out.")
      .addText((t) => t.setValue(settings.captureFile).onChange(async (v) => {
        settings.captureFile = v;
        await save();
      }));

    new Setting(containerEl).setName("Shortcut bar").setHeading();
    new Setting(containerEl)
      .setName("Show the shortcut bar")
      .addToggle((t) => t.setValue(settings.showShortcutBar).onChange(async (v) => {
        settings.showShortcutBar = v;
        await save();
      }));
    // BAR-10: the buttons on the bar first, in bar order, with arrows to move them; then the rest
    const shown = (id: string) => barButtons([id]).some((b) => this.plugin.hasButton(b));
    const on = barButtons(settings.shortcutBarButtons).filter((b) => this.plugin.hasButton(b));
    const off = BUTTONS.filter((b) => this.plugin.hasButton(b) && !on.includes(b));
    const move = async (id: string, delta: -1 | 1) => {
      settings.shortcutBarButtons = moveButton(settings.shortcutBarButtons, id, delta, shown);
      await save();
      this.display();
    };
    for (const def of [...on, ...off]) {
      const setting = new Setting(containerEl).setName(def.name);
      const position = on.indexOf(def);
      if (position >= 0) {
        setting.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move left on the bar")
          .setDisabled(position === 0).onClick(() => void move(def.id, -1)));
        setting.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move right on the bar")
          .setDisabled(position === on.length - 1).onClick(() => void move(def.id, 1)));
      }
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
      setting.addToggle((t) => t.setValue(position >= 0).onChange(async (v) => {
        settings.shortcutBarButtons = toggleButton(settings.shortcutBarButtons, def.id, v);
        await save();
        this.display();
      }));
    }
  }
}
