// The timeline (§11b): a tab listing every node newest first, with the
// attachments each one links to.

import type OrgFlexPlugin from "../main";
import { TIMELINE_VIEW, TimelineView } from "../ui/timeline-view";
import type { Feature } from "./feature";

/** TL-1: show the timeline tab, reusing an open one. */
async function openTimeline(plugin: OrgFlexPlugin) {
  const { workspace } = plugin.app;
  const leaf = workspace.getLeavesOfType(TIMELINE_VIEW)[0] ?? workspace.getLeaf(false);
  if (leaf.view.getViewType() !== TIMELINE_VIEW) await leaf.setViewState({ type: TIMELINE_VIEW, active: true });
  else (leaf.view as TimelineView).render();
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
};
