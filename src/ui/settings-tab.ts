// The settings tab (§12): only what differs between vaults and devices.
// Workflow choices are in the flavour (src/flavour.ts, §12a).

import { App, PluginSettingTab, Setting } from "obsidian";
import type OrgFlexPlugin from "../main";
import { FEATURES, hasFeature } from "../features";
import { startView } from "../settings";

export class OrgFlexSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: OrgFlexPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    // PLAT-10
    const starts = FEATURES.filter((f) => f.start);
    if (starts.length) {
      new Setting(containerEl).setName("Startup").setHeading();
      new Setting(containerEl)
        .setName("Open on startup")
        .setDesc("Shown in the current tab once Obsidian has started.")
        .addDropdown((d) => {
          d.addOption("", "Nothing");
          for (const f of starts) d.addOption(f.id, f.start!.name);
          d.setValue(startView(settings.startView, starts.map((f) => f.id)) ?? "").onChange(async (v) => {
            settings.startView = v;
            await save();
          });
        });
    }

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

    if (hasFeature("backlinks")) {
      new Setting(containerEl).setName("Backlinks").setHeading();
      new Setting(containerEl)
        .setName("Show backlinks")
        .setDesc("Linked and unlinked mentions at the end of every org note.")
        .addToggle((t) => t.setValue(settings.showBacklinks).onChange(async (v) => {
          settings.showBacklinks = v;
          await save();
        }));
    }

    new Setting(containerEl).setName("Shortcut bar").setHeading();
    new Setting(containerEl)
      .setName("Show the shortcut bar")
      .addToggle((t) => t.setValue(settings.showShortcutBar).onChange(async (v) => {
        settings.showShortcutBar = v;
        await save();
      }));
  }
}
