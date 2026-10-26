// Attachments (§10d): attach images and audio, or record a voice note.

import { Notice } from "obsidian";
import { EditorView } from "@codemirror/view";
import type { OrgFlexView } from "../view";
import { insertFileLinks, pastedFiles, pastedName, recordingExtension, recordingName } from "../org/edit";
import { relativeLinkPath } from "../org/syntax";
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
    void saveAttachments(view, [{ name: recordingName(new Date(), recordingExtension(mime)), data: blob.arrayBuffer() }]);
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
      void saveAttachments(view, files.map((f) => ({ name: pastedName(f.name, f.type, now), data: f.arrayBuffer() })));
      return true;
    },
  });
}

/** ATT-3: each file saved where Obsidian puts attachments for this note, then linked at the cursor. */
async function saveAttachments(view: OrgFlexView, files: { name: string; data: Promise<ArrayBuffer> }[]) {
  const { app } = view;
  const note = view.file;
  if (!note) return;
  const paths: string[] = [];
  for (const f of files) {
    try {
      const path = await app.fileManager.getAvailablePathForAttachment(f.name, note.path);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
      const file = await app.vault.createBinary(path, await f.data);
      paths.push(relativeLinkPath(note.path, file.path));
    } catch (e) {
      new Notice(`Couldn't save ${f.name}: ${(e as Error).message}`);
    }
  }
  const editor = view.editor;
  const spec = editor && view.file === note ? insertFileLinks(editor.state, paths) : null;
  if (editor && spec) editor.dispatch(spec);
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
