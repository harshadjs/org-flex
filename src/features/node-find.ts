// Go to node (§10b): find a note or heading by title, or create the note.

import type OrgFlexPlugin from "../main";
import { NodeFinderModal } from "../ui/modals";
import type { Feature } from "./feature";

/** FIND-1..3: org-roam-node-find. */
function findNode(plugin: OrgFlexPlugin) {
  new NodeFinderModal(plugin.app, plugin.index.titles(), (choice) => {
    const leaf = plugin.app.workspace.getLeaf(false);
    if (choice.kind === "node") {
      void plugin.openLink(`id:${choice.node.id}`, "", leaf);
      return;
    }
    void plugin.createRootNote(choice.title).file.then((file) => file && plugin.openNewNote(leaf, file));
  }).open();
}

export const nodeFind: Feature = {
  id: "node-find",
  section: "10b. Go to node",
  load(plugin) {
    plugin.addCommand({ id: "org-roam-node-find", name: "Go to node (find or create)", callback: () => findNode(plugin) });
  },
  buttons: { "node-find": (plugin) => findNode(plugin) },
};
