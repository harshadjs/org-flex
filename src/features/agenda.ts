// The agenda (§11a): a tab listing the week's tasks and dates from the
// top-level org files.

import type OrgFlexPlugin from "../main";
import { AGENDA_VIEW, AgendaView } from "../ui/agenda-view";
import type { Feature } from "./feature";

/** AG-1: show the agenda tab, reusing an open one. */
async function openAgenda(plugin: OrgFlexPlugin) {
  const { workspace } = plugin.app;
  const leaf = workspace.getLeavesOfType(AGENDA_VIEW)[0] ?? workspace.getLeaf(false);
  // a tab restored at startup may not be loaded yet (Obsidian 1.7.2+): load it before using its view
  if (typeof leaf.loadIfDeferred === "function") await leaf.loadIfDeferred();
  if (leaf.view instanceof AgendaView) await leaf.view.render();
  else await leaf.setViewState({ type: AGENDA_VIEW, active: true });
  workspace.setActiveLeaf(leaf, { focus: true });
}

export const agendaFeature: Feature = {
  id: "agenda",
  section: "11a. Agenda",
  load(plugin) {
    plugin.registerView(AGENDA_VIEW, (leaf) => new AgendaView(leaf, plugin));
    plugin.addCommand({ id: "org-agenda", name: "Open agenda", callback: () => void openAgenda(plugin) });
  },
  buttons: {
    agenda: (plugin) => void openAgenda(plugin),
  },
  start: { name: "Agenda", open: openAgenda },
};
