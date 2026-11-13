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

/** AG-5: the first day of the week span `n` spans from today's: today + 7 × n. */
export function weekSpanStart(today: Date, n: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7 * n);
}

/** AG-5, AG-6: the 1st of the month `n` months from today's. */
export function monthStart(today: Date, n: number): Date {
  return new Date(today.getFullYear(), today.getMonth() + n, 1);
}

/** AG-6: the month grid's days: whole weeks, Monday first, from the Monday on or before the 1st to the Sunday on or after the last day. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const from = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
  const count = dayOffset(last, from) + 1 + (6 - ((last.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
}

/** AG-6: a month cell's titles: the first `max`, and how many more there are. */
export function cellTitles(titles: string[], max = 2): { shown: string[]; more: number } {
  return { shown: titles.slice(0, max), more: Math.max(0, titles.length - max) };
}

/** AG-6, TL-9: the month view's chosen day: the one chosen if it is in `month`, else today when the month holds it, else the 1st. */
export function chosenDay(chosen: Date | null, month: Date, today: Date): Date {
  const inMonth = (d: Date) => d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
  if (chosen && inMonth(chosen)) return chosen;
  return inMonth(today) ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : new Date(month.getFullYear(), month.getMonth(), 1);
}
