// Daily journal (§10): one file per day at <folder>/YYYY/MM/YYYY-MM-DD.org,
// started from a template; with Denote, <folder>/YYYY/MM/ID--YYYY-MM-DD__journal.org.

import { denoteFileName, denoteFrontMatter } from "./denote";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" in local time. */
export function journalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** A local Date for "YYYY-MM-DD". */
export function parseJournalDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The folder without leading or trailing slashes; "" is the vault root. */
export function cleanFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

/** JRN-1: the day's file; DEN-6: with a Denote identifier, `ID--YYYY-MM-DD__journal.org`. */
export function journalPathForDate(folder: string, date: Date, denoteId?: string): string {
  const root = cleanFolder(folder);
  const day = journalDateString(date);
  const name = denoteId === undefined ? `${day}.org` : denoteFileName(denoteId, day, ["journal"], "org");
  const path = `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${name}`;
  return root ? `${root}/${path}` : path;
}

/** DEN-6: a new Denote journal file: the day as title, keyword `journal`, dated `now`. */
export function denoteJournalContent(date: Date, id: string, now: Date): string {
  return denoteFrontMatter(journalDateString(date), now, ["journal"], id);
}

/** JRN-2: the base flavour's journal header: a new UUID as `:ID:`, the date as title. */
export const DEFAULT_JOURNAL_TEMPLATE = ":PROPERTIES:\n:ID:       {{id}}\n:END:\n#+title: {{date}}\n\n";

/** JRN-2: a new journal file: `{{date}}` becomes YYYY-MM-DD and `{{id}}` the given UUID, every time they occur. */
export function journalFileContent(date: Date, template: string, id: string): string {
  const day = journalDateString(date);
  return template.replace(/\{\{\s*(date|id)\s*\}\}/gi, (_m, key: string) => (key.toLowerCase() === "date" ? day : id));
}

export interface JournalEntry {
  path: string;
  date: string;
}

/** JRN-3: files named YYYY-MM-DD.org (DEN-6: or ID--YYYY-MM-DD__keywords.org) at any depth under `folder`, newest first. */
export function journalEntries(paths: string[], folder: string): JournalEntry[] {
  const root = cleanFolder(folder);
  const prefix = root ? `${root}/` : "";
  const entries: JournalEntry[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const m = /(?:^|\/)(?:[0-9A-Za-z]+--)?(\d{4}-\d{2}-\d{2})(?:__[^/]*)?\.org$/.exec(path);
    if (m) entries.push({ path, date: m[1] });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
}

/** JRN-3: "YYYY-MM-DD · Weekday, Month D". */
export function journalEntryLabel(day: string, locale?: string): string {
  const date = parseJournalDate(day);
  const weekday = date.toLocaleDateString(locale, { weekday: "long" });
  const month = date.toLocaleDateString(locale, { month: "long", day: "numeric" });
  return `${day} · ${weekday}, ${month}`;
}

export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
}

/**
 * JRN-4: the weeks shown for `month` (0-11) of `year`, each 7 days starting
 * on `weekStart` (0 = Sunday), padded with days of the months around it.
 */
export function calendarMonth(year: number, month: number, weekStart: number): CalendarCell[][] {
  const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(year, month, 1 - lead + i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ date: journalDateString(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return weeks;
}

/** The locale's first day of the week (0 = Sunday), Monday if unknown. */
export function localeWeekStart(locale?: string): number {
  try {
    const loc = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // older engines: fall through
  }
  return 1;
}
