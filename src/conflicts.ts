// PLAT-6: only one plugin can open .org files. When another got there
// first, say which one to turn off. No Obsidian imports, so it can be tested.

/** Plugins known to open .org files, by id, with the name they show in Settings. */
export const ORG_PLUGINS: Record<string, string> = {
  "orgmode-cm6": "Orgmode (cm6)",
};

/**
 * PLAT-6: the notice when `.org` is taken: the enabled plugins known to open
 * it by name, else the view type that took it, else a general hint.
 */
export function orgConflictMessage(enabledPlugins: Iterable<string>, owner: string | null): string {
  const names = Array.from(enabledPlugins).filter((id) => id in ORG_PLUGINS).map((id) => `"${ORG_PLUGINS[id]}"`);
  const who = names.length ? names.join(" and ") : owner ? `the plugin whose view is "${owner}"` : "another plugin";
  return `Org Flex can't open .org files because ${who} already does. Turn it off in Settings › Community plugins, then turn Org Flex off and on again.`;
}
