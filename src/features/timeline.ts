// The timeline (§11b): a tab listing every node newest first, with the
// attachments each one links to.

import type OrgFlexPlugin from "../main";
import { TIMELINE_VIEW, TimelineView } from "../ui/timeline-view";
import type { Feature } from "./feature";

/** TL-1: show the timeline tab, reusing an open one. */
async function openTimeline(plugin: OrgFlexPlugin) {
  const { workspace } = plugin.app;
  const leaf = workspace.getLeavesOfType(TIMELINE_VIEW)[0] ?? workspace.getLeaf(false);
  // a tab restored at startup may not be loaded yet (Obsidian 1.7.2+): load it before using its view
  if (typeof leaf.loadIfDeferred === "function") await leaf.loadIfDeferred();
  if (leaf.view instanceof TimelineView) leaf.view.render();
  else await leaf.setViewState({ type: TIMELINE_VIEW, active: true });
  workspace.setActiveLeaf(leaf, { focus: true });
}

export const timelineFeature: Feature = {
  id: "timeline",
  section: "11b. Timeline",
  load(plugin) {
    plugin.registerView(TIMELINE_VIEW, (leaf) => new TimelineView(leaf, plugin));
    plugin.addCommand({ id: "org-timeline", name: "Open timeline", callback: () => void openTimeline(plugin) });
  },
  buttons: {
    timeline: (plugin) => void openTimeline(plugin),
  },
  start: { name: "Timeline", open: openTimeline },
};
