// The flavour (§12a): how this copy of Org Flex is set up for the way its
// user works with Org. These are code, not settings: a fork changes them here
// (usually through TAILOR.md), next to the rules they feed, and the spec's
// §12a table says what each one does. Which features this copy has is the
// list in src/features/index.ts (PLAT-8). Settings (src/settings.ts) only
// hold what differs between one person's vaults and devices.

import type { VisibilityLevel } from "./org/folding";
import { DEFAULT_JOURNAL_TEMPLATE } from "./org/journal";

export interface Flavour {
  /** open-task keywords, in cycling order (PARSE-3, ACT-3) */
  todoKeywords: string[];
  /** closed-task keywords */
  doneKeywords: string[];
  /** priority of tasks that have none, when sorting task blocks (TASK-2) */
  defaultPriority: string;
  /** LP-7 */
  hideStars: boolean;
  /** FOLD-4, FM-4 */
  foldPropertyDrawers: boolean;
  /** FOLD-5 */
  defaultFoldLevel: VisibilityLevel;
  /** JRN-2: `{{date}}` and `{{id}}` are filled in */
  journalTemplate: string;
}

export const FLAVOUR: Flavour = {
  todoKeywords: ["TODO", "NEXT", "DOING", "WAITING"],
  doneKeywords: ["DONE", "CANCELLED"],
  defaultPriority: "B",
  hideStars: false,
  foldPropertyDrawers: true,
  defaultFoldLevel: "foldall",
  journalTemplate: DEFAULT_JOURNAL_TEMPLATE,
};
