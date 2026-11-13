// The notes grid (§11c): every org file as a Keep-style card, pinned first,
// then the most recently changed; the default start view (PLAT-10).

import type OrgFlexPlugin from "../main";
import { GRID_VIEW, GridView } from "../ui/grid-view";
import type { Feature } from "./feature";

/** GRID-1: show the grid, reusing an open one, else in the current tab. */
async function openGrid(plugin: OrgFlexPlugin) {
  const { workspace } = plugin.app;
  const leaf = workspace.getLeavesOfType(GRID_VIEW)[0] ?? workspace.getLeaf(false);
  // a tab restored at startup may not be loaded yet (Obsidian 1.7.2+): load it before using its view
  if (typeof leaf.loadIfDeferred === "function") await leaf.loadIfDeferred();
  if (leaf.view instanceof GridView) leaf.view.render();
  else await leaf.setViewState({ type: GRID_VIEW, active: true });
  workspace.setActiveLeaf(leaf, { focus: true });
}

export const gridFeature: Feature = {
  id: "grid",
  section: "11c. Notes grid",
  load(plugin) {
    plugin.registerView(GRID_VIEW, (leaf) => new GridView(leaf, plugin));
    plugin.addCommand({ id: "org-notes-grid", name: "Open notes grid", callback: () => void openGrid(plugin) });
  },
  buttons: {
    grid: (plugin) => void openGrid(plugin),
  },
  // PLAT-10: this copy opens on the grid by default
  start: { name: "Notes grid", open: openGrid },
};
