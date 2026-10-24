// A feature (PLAT-8): one part of Org Flex that a fork may keep, change or
// drop as a whole. It owns a SPEC.md section, this file (and the pure logic
// and dialogs it names there) and their tests; the core reaches it only
// through FEATURES (./index.ts), so removing one is deleting its line there,
// its files and its section.

import type { Extension } from "@codemirror/state";
import type OrgFlexPlugin from "../main";
import type { OrgFlexView } from "../view";
import type { ButtonId } from "../settings";

export interface Feature {
  /** short name, also the file name: `src/features/<id>.ts` */
  id: string;
  /** the SPEC.md section it owns, as its heading reads after `## ` */
  section: string;
  /** once, when the plugin loads: commands, ribbon icons, events */
  load?(plugin: OrgFlexPlugin): void;
  /** CodeMirror extensions for each org view */
  editor?(view: OrgFlexView): Extension;
  /** after a view has loaded a file */
  opened?(view: OrgFlexView): void;
  /** what its shortcut bar buttons do */
  buttons?: Partial<Record<ButtonId, (plugin: OrgFlexPlugin, view: OrgFlexView) => void>>;
}
