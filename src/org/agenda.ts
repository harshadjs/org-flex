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
