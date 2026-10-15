// Daily journal (§10): one file per day at <folder>/YYYY/MM/YYYY-MM-DD.org,
// whose :ID: is the date.

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

export function journalPathForDate(folder: string, date: Date): string {
  const root = cleanFolder(folder);
  const path = `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${journalDateString(date)}.org`;
  return root ? `${root}/${path}` : path;
}

/** JRN-2: the header of a new journal file. */
export function journalFileContent(date: Date): string {
  const day = journalDateString(date);
  return `:PROPERTIES:\n:ID:       ${day}\n:END:\n#+title: ${day}\n#+filetags: :journal:\n\n`;
}

export interface JournalEntry {
  path: string;
  date: string;
}

/** JRN-3: files named YYYY-MM-DD.org at any depth under `folder`, newest first. */
export function journalEntries(paths: string[], folder: string): JournalEntry[] {
  const root = cleanFolder(folder);
  const prefix = root ? `${root}/` : "";
  const entries: JournalEntry[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const m = /(?:^|\/)(\d{4}-\d{2}-\d{2})\.org$/.exec(path);
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
