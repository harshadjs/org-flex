// The notes grid (§11c): every org file as a Keep-style card, pinned first,
// then the most recently changed; optionally the start page.

import type OrgFlexPlugin from "../main";
import { FLAVOUR } from "../flavour";
import { GRID_VIEW, GridView } from "../ui/grid-view";
import type { Feature } from "./feature";

/** GRID-1: show the grid, reusing an open one, else in the current tab. */
async function openGrid(plugin: OrgFlexPlugin) {
  const { workspace } = plugin.app;
  const leaf = workspace.getLeavesOfType(GRID_VIEW)[0] ?? workspace.getLeaf(false);
  if (leaf.view.getViewType() !== GRID_VIEW) await leaf.setViewState({ type: GRID_VIEW, active: true });
  else (leaf.view as GridView).render();
  workspace.setActiveLeaf(leaf, { focus: true });
}

export const gridFeature: Feature = {
  id: "grid",
  section: "11c. Notes grid",
  load(plugin) {
    plugin.registerView(GRID_VIEW, (leaf) => new GridView(leaf, plugin));
    plugin.addCommand({ id: "org-notes-grid", name: "Open notes grid", callback: () => void openGrid(plugin) });
    // GRID-1: the start page, once the restored tabs are back
    if (FLAVOUR.gridStartPage) plugin.app.workspace.onLayoutReady(() => void openGrid(plugin));
  },
};
