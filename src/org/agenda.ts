// The agenda (§11a): which files it reads and what it shows. The grouping
// by day is `agenda` in ./query, shared with the task blocks (TASK-5).

/** AG-2: every task that isn't done, and headings without a keyword (their timestamps). */
export const AGENDA_QUERY = ".it.done";

/** AG-2: today and the six days after it. */
export const AGENDA_DAYS = 7;

/** AG-1: the `.org` files at the vault's top level, as `org-agenda-files` set to `org-directory`'s `*.org`; sorted. */
export function agendaFiles(paths: string[]): string[] {
  return paths.filter((p) => !p.includes("/") && p.toLowerCase().endsWith(".org")).sort();
}

/** AG-4: whole days from `today` to `date` (negative when it has passed), by the calendar, not by 24-hour spans. */
export function dayOffset(date: Date, today: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}

/** AG-4: "today", "tomorrow", "3 days ago" in `locale`, for a day `offset` days from today. */
export function relativeDay(offset: number, locale: string): string {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, "day");
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(offset, "day");
  }
}
