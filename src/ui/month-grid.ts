// The month grid and the moving buttons shared by the agenda (AG-5, AG-6)
// and the timeline (TL-9): whole weeks, Monday first, a few titles a day.

import { setIcon } from "obsidian";
import { onTap } from "../editor/state";
import { cellTitles, monthGrid } from "../org/agenda";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** AG-5, TL-9: ‹ and › by one `unit`, then Today while `offset` isn't 0 */
export function drawStepper(nav: HTMLElement, unit: string, offset: number, move: (offset: number) => void) {
  const step = (label: string, icon: string, by: number) => {
    const b = nav.createEl("button", { cls: "org-month-step clickable-icon", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", () => move(offset + by));
  };
  step(`Previous ${unit}`, "chevron-left", -1);
  step(`Next ${unit}`, "chevron-right", 1);
  if (offset !== 0) nav.createEl("button", { cls: "org-month-today", text: "Today" }).addEventListener("click", () => move(0));
}

/** AG-6, TL-9: a switch between views, e.g. Week / Month; `set` is called only for a change */
export function drawModes<T extends string>(nav: HTMLElement, modes: readonly (readonly [T, string])[], current: T, set: (mode: T) => void) {
  const el = nav.createDiv({ cls: "org-month-modes" });
  for (const [mode, label] of modes) {
    const b = el.createEl("button", { cls: "org-month-mode", text: label, attr: { "aria-pressed": String(current === mode) } });
    b.toggleClass("is-active", current === mode);
    b.addEventListener("click", () => {
      if (current !== mode) set(mode);
    });
  }
}

export interface MonthGridOptions {
  /** the 1st of the month */
  month: Date;
  now: Date;
  chosen: Date;
  locale: string;
  /** the titles of a day's items, in order */
  titles(date: Date): string[];
  choose(date: Date): void;
}

/** AG-6, TL-9: the weekday names, then a cell per day: its number, 2 titles and "+N"; tapping one chooses it */
export function drawMonthGrid(parent: HTMLElement, o: MonthGridOptions) {
  const grid = monthGrid(o.month);
  const el = parent.createDiv({ cls: "org-month" });
  for (const d of grid.slice(0, 7)) el.createDiv({ cls: "org-month-wd", text: d.toLocaleDateString(o.locale, { weekday: "short" }) });
  for (const date of grid) {
    const cell = el.createDiv({ cls: "org-month-cell" });
    cell.toggleClass("is-outside", date.getMonth() !== o.month.getMonth());
    cell.toggleClass("is-today", sameDay(date, o.now));
    cell.toggleClass("is-chosen", sameDay(date, o.chosen));
    cell.createDiv({ cls: "org-month-cell-num", text: String(date.getDate()) });
    const { shown, more } = cellTitles(o.titles(date));
    for (const t of shown) cell.createDiv({ cls: "org-month-cell-title", text: t });
    if (more) cell.createDiv({ cls: "org-month-cell-more", text: `+${more}` });
    onTap(cell, () => o.choose(date));
  }
}

/** AG-6, TL-9: a month's name as a title, "November 2026" */
export function monthName(month: Date, locale: string): string {
  const name = month.toLocaleDateString(locale, { month: "long", year: "numeric" });
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}
