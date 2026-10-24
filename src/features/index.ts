// The features this copy of Org Flex has (PLAT-8). To drop one, delete its
// line here, its file in this folder (and the pure logic and dialogs only it
// uses), its SPEC.md section and its tests; the core doesn't refer to it.
// To add one, write src/features/<id>.ts and a SPEC.md section, then list it.

import type { ButtonId } from "../settings";
import type { Feature } from "./feature";
import { attachments } from "./attachments";
import { backlinks } from "./backlinks";
import { captureFeature } from "./capture";
import { frontMatter } from "./front-matter";
import { journal } from "./journal";
import { newNoteFeature } from "./new-note";
import { nodeFind } from "./node-find";
import { taskBlocks } from "./task-blocks";

export type { Feature };

export const FEATURES: Feature[] = [
  backlinks,
  frontMatter,
  journal,
  newNoteFeature,
  nodeFind,
  captureFeature,
  attachments,
  taskBlocks,
];

export function hasFeature(id: string): boolean {
  return FEATURES.some((f) => f.id === id);
}

/** BAR-2: the feature that runs a bar button, if any does. */
export function buttonFeature(id: ButtonId): Feature | undefined {
  return FEATURES.find((f) => f.buttons?.[id]);
}
