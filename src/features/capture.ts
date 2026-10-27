// Capture (§10c): one box that files a task at the end of the inbox.

import { Notice, TFile } from "obsidian";
import type OrgFlexPlugin from "../main";
import { FLAVOUR } from "../flavour";
import { appendEntry, captureEntry, capturePath, captureStates, noteCaptureText, sharedCaptureText } from "../org/capture";
import { noteFileContent } from "../org/new-note";
import { readNote } from "../org/vault-index";
import { CaptureChoice, CaptureModal } from "../ui/modals";
import type { Feature } from "./feature";

/**
 * CAP-1: the capture dialog, with `initial` already typed (CAP-6), or, with
 * none, a link to the org note being viewed (CAP-9).
 */
function capture(plugin: OrgFlexPlugin, initial?: string) {
  const path = capturePath(plugin.settings.captureFile);
  const states = captureStates(FLAVOUR.todoKeywords, FLAVOUR.doneKeywords);
  let text = initial ?? "";
  let cursor = text.length;
  const view = initial === undefined ? plugin.activeView() : null;
  if (view?.file && view.file.path !== path) {
    text = noteCaptureText(readNote(view.file.path, view.getViewData(), plugin.keywords()), plugin.scheme());
    cursor = 0;
  }
  new CaptureModal(plugin.app, path, text, cursor, states, (choice) => fileCapture(plugin, path, choice)).open();
}

/** CAP-2, CAP-3, CAP-5: add the entry (CAP-7, CAP-8: with the chosen state and date) to the inbox, creating it when missing; why not, or null when done. */
async function fileCapture(plugin: OrgFlexPlugin, path: string, choice: CaptureChoice): Promise<string | null> {
  const { app } = plugin;
  const entry = captureEntry(choice.text, choice.state, choice.scheduled);
  if (!entry) return "Type something to capture.";
  try {
    let file = app.vault.getAbstractFileByPath(path);
    if (!file) {
      const slash = path.lastIndexOf("/");
      if (slash > 0) await plugin.ensureFolder(path.slice(0, slash));
      const name = path.slice(slash + 1).replace(/\.org$/, "");
      file = await app.vault.create(path, noteFileContent(name, plugin.newOrgId()));
    }
    if (!(file instanceof TFile)) return `${path} is not a file.`;
    // an open inbox takes it as an edit, so nothing typed there is lost
    let done = false;
    plugin.forEachView((v) => { if (!done && v.file?.path === path) done = v.appendEntry(entry); });
    if (!done) await app.vault.process(file, (data) => {
      const { from, insert } = appendEntry(data, entry);
      return data.slice(0, from) + insert;
    });
    new Notice(`Captured to ${path}`);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export const captureFeature: Feature = {
  id: "capture",
  section: "10c. Capture",
  load(plugin) {
    plugin.addCommand({ id: "org-capture", name: "Capture to inbox", callback: () => capture(plugin) });
    plugin.addRibbonIcon("inbox", "Capture to inbox", () => capture(plugin));
    // CAP-6: obsidian://org-capture?title=…&text=…&url=…
    plugin.registerObsidianProtocolHandler("org-capture",
      (params) => capture(plugin, sharedCaptureText({ title: params.title, text: params.text, url: params.url })));
  },
  buttons: { capture: (plugin) => capture(plugin) },
};
