// Attachments (§10d): attach images and audio, or record a voice note, into
// the owning node's org-attach folder (ATT-7).

import { Notice, type App } from "obsidian";
import { EditorView } from "@codemirror/view";
import type { OrgFlexView } from "../view";
import { assignId, insertFileLinks, pastedFiles, pastedImageExtension, recordingExtension, type MediaKind } from "../org/edit";
import { FLAVOUR } from "../flavour";
import { relativeLinkPath } from "../org/syntax";
import { denoteFileName } from "../org/denote";
import { attachDirFor, attachOwner, freeAttachmentPath, withAttachTag } from "../org/attach";
import { createdStamp } from "../org/ids";
import { RecorderModal } from "../ui/modals";
import type { Feature } from "./feature";

/** ATT-2: pick any files (on the phone: gallery, camera, recorder or files), save and link them. */
function attach(view: OrgFlexView) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  // some phone web views only open the chooser for an input in the page
  input.hide();
  document.body.appendChild(input);
  input.addEventListener("cancel", () => input.remove());
  input.addEventListener("change", () => {
    input.remove();
    const files = Array.from(input.files ?? []);
    if (files.length) void saveAttachments(view, files.map((f) => ({ name: f.name, data: f.arrayBuffer() })));
  });
  input.click();
}

/** ATT-4: record from the microphone, then save and link the recording. */
function record(view: OrgFlexView) {
  new RecorderModal(view.app, (blob, mime) => {
    void saveAttachments(view, [{ name: { kind: "recording", date: new Date(), ext: recordingExtension(mime) }, data: blob.arrayBuffer() }]);
  }).open();
}

/** ATT-5: a paste of images or files saves them as attachments and links them, instead of pasting nothing. */
function pasteHandler(view: OrgFlexView) {
  return EditorView.domEventHandlers({
    paste(event) {
      const data = event.clipboardData;
      if (!data || view.reading) return false;
      const files = pastedFiles(Array.from(data.files), data.getData("text/plain"));
      if (!files.length) return false;
      event.preventDefault();
      const now = new Date();
      void saveAttachments(view, files.map((f) => {
        const ext = pastedImageExtension(f.name, f.type);
        return { name: ext === null ? f.name : { kind: "image" as const, date: now, ext }, data: f.arrayBuffer() };
      }));
      return true;
    },
  });
}

/** DEN-8: with Denote, `name.ext` becomes `ID--name.ext`, with a new identifier. */
function savedName(view: OrgFlexView, name: string): { name: string; id: string | null } {
  if (view.plugin.scheme() !== "denote") return { name, id: null };
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const id = view.plugin.newDenoteId(new Date());
  return { name: denoteFileName(id, stem, [], ext), id };
}

/** A file the plugin names itself (ATT-6), from what it is, when and its extension. */
type MediaToName = { kind: MediaKind; date: Date; ext: string };

/**
 * ATT-6: the flavour's name for a recording or pasted image, given the names
 * of every file in the vault, so the count goes on wherever the earlier ones are.
 */
function mediaName(app: App, media: MediaToName): string {
  const taken = new Set(app.vault.getFiles().map((f) => f.name));
  return FLAVOUR.mediaName(media.kind, media.date, media.ext, taken);
}

/**
 * ATT-3: each file saved and linked at the cursor. With org-roam IDs (ATT-7)
 * it goes in the org-attach folder of the node that owns the cursor (the
 * nearest heading or file above with an `:ID:`; the file, or the heading the
 * file starts with, gets one when none has), linked as `attachment:NAME`, and
 * a heading that owns it gets the `ATTACH` tag. With Denote (DEN-8) it is
 * saved where Obsidian puts attachments and linked as `denote:ID`.
 */
async function saveAttachments(view: OrgFlexView, files: { name: string | MediaToName; data: Promise<ArrayBuffer> }[]) {
  const { app } = view;
  const note = view.file;
  if (!note) return;
  const denote = view.plugin.scheme() === "denote";
  const owner = denote ? null : attachmentOwner(view);
  if (!denote && !owner) {
    new Notice("Couldn't find or make a node to attach to.");
    return;
  }
  const targets: string[] = [];
  for (const f of files) {
    try {
      // named one at a time, so a second paste counts the first
      const saved = savedName(view, typeof f.name === "string" ? f.name : mediaName(app, f.name));
      let path: string;
      if (owner) {
        const dir = attachDirFor(FLAVOUR.attachDir, owner.id);
        path = freeAttachmentPath(dir, saved.name, (p) => app.vault.getAbstractFileByPath(p) !== null);
        await view.plugin.ensureFolder(dir);
      } else {
        path = await app.fileManager.getAvailablePathForAttachment(saved.name, note.path);
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
      }
      const file = await app.vault.createBinary(path, await f.data);
      targets.push(saved.id !== null ? `denote:${saved.id}` : owner ? `attachment:${file.name}` : `file:${relativeLinkPath(note.path, file.path)}`);
    } catch (e) {
      new Notice(`Couldn't save ${typeof f.name === "string" ? f.name : "the file"}: ${(e as Error).message}`);
    }
  }
  const editor = view.editor;
  if (!editor || view.file !== note) return;
  const spec = insertFileLinks(editor.state, targets);
  if (spec) editor.dispatch(spec);
  // ATT-7: the heading owning them is tagged, as org-attach does
  if (owner?.heading !== null && owner?.heading !== undefined && targets.length) {
    const line = editor.state.doc.line(owner.heading + 1);
    const tagged = withAttachTag(line.text);
    if (tagged !== line.text) editor.dispatch({ changes: { from: line.from, to: line.to, insert: tagged }, userEvent: "input" });
  }
}

/** ATT-7: the node owning the cursor, giving the file (or, when it starts with a heading, the cursor's heading) an ID when none has one; null with no editor. */
function attachmentOwner(view: OrgFlexView): { id: string; heading: number | null } | null {
  const editor = view.editor;
  if (!editor) return null;
  const find = () => {
    const doc = editor.state.doc;
    return attachOwner((n) => doc.line(n + 1).text, doc.lines, doc.lineAt(editor.state.selection.main.head).number - 1);
  };
  const found = find();
  if (found) return found;
  // the file gets the ID; a file that starts with a heading has no room above it, so the cursor's heading does
  for (const pos of [0, editor.state.selection.main.head]) {
    const spec = assignId(editor.state, view.plugin.newOrgId(), pos, "ID", createdStamp(new Date()));
    if (spec) editor.dispatch(spec);
    const now = find();
    if (now) return now;
  }
  return null;
}

export const attachments: Feature = {
  id: "attachments",
  section: "10d. Attachments",
  editor: pasteHandler,
  buttons: {
    attach: (_plugin, view) => attach(view),
    record: (_plugin, view) => record(view),
  },
};
