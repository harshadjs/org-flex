// The flavour (§12a): how this copy of Org Flex is set up for the way its
// user works with Org. These are code, not settings: a fork changes them here
// (usually through TAILOR.md), next to the rules they feed, and the spec's
// §12a table says what each one does. Which features this copy has is the
// list in src/features/index.ts (PLAT-8). Settings (src/settings.ts) only
// hold what differs between one person's vaults and devices.

import type { VisibilityLevel } from "./org/folding";
import { DEFAULT_JOURNAL_TEMPLATE } from "./org/journal";
import type { LinkScheme } from "./org/vault-index";

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
  /** JRN-2: `{{date}}` and `{{id}}` are filled in (not used with Denote, DEN-6) */
  journalTemplate: string;
  /** DEN-1: link notes by `:ID:` as org-roam does, or by the identifier in Denote file names */
  links: LinkScheme;
  /** DEN-5: the identifier for a note or file made at `date`, not one of `taken` */
  denoteId(date: Date, taken: ReadonlySet<string>): string;
  /** DEN-6: the identifier for the journal file of the day `date` */
  journalId(date: Date, taken: ReadonlySet<string>): string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYMM` of `date`, in local time. */
function yearMonth(date: Date): string {
  return `${pad2(date.getFullYear() % 100)}${pad2(date.getMonth() + 1)}`;
}

/** 1 → a, 26 → z, 27 → aa, 28 → ab … */
function letters(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + ((n - 1) % 26)) + s;
  return s;
}

function letterNumber(s: string): number {
  let n = 0;
  for (const c of s) n = n * 26 + (c.charCodeAt(0) - 96);
  return n;
}

/**
 * DEN-5, this flavour: `YYMM` then letters, one after the highest in use that
 * month (`2610a` … `2610z`, `2610aa` …), so an identifier is never given twice.
 */
export function monthLetterId(date: Date, taken: ReadonlySet<string>): string {
  const prefix = yearMonth(date);
  let highest = 0;
  for (const id of taken) {
    const m = /^(\d{4})([a-z]+)$/.exec(id);
    if (m && m[1] === prefix) highest = Math.max(highest, letterNumber(m[2]));
  }
  return prefix + letters(highest + 1);
}

/** DEN-6, this flavour: a journal day is `YYMMDD` (`261003`). */
export function dayId(date: Date): string {
  return `${yearMonth(date)}${pad2(date.getDate())}`;
}

export const FLAVOUR: Flavour = {
  todoKeywords: ["TODO", "NEXT", "DOING", "WAITING"],
  doneKeywords: ["DONE", "CANCELLED"],
  defaultPriority: "B",
  hideStars: false,
  foldPropertyDrawers: true,
  defaultFoldLevel: "foldall",
  journalTemplate: DEFAULT_JOURNAL_TEMPLATE,
  links: "denote",
  denoteId: monthLetterId,
  journalId: dayId,
};
