// A subset of Orgzly's search language (TASK-4), for the Markdown task list.
//
//   it.todo it.done it.none i.<keyword>      state (`.` in front negates)
//   s. d. c. [eq|ne|lt|le|gt|ge.]<time>      scheduled, deadline, closed
//   o.s o.d o.c o.p o.st (.o.x descending)   sorting
//   ad.N                                     agenda of N days
//   and, or, space (and), parentheses

import { occursOn, type Stamp } from "./repeat";
import { OrgTask } from "./tasks";

export class QueryError extends Error {}

type Op = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export type Condition =
  | { type: "state"; which: "todo" | "done" | "none" }
  | { type: "keyword"; keyword: string }
  | { type: "date"; field: "scheduled" | "deadline" | "closed"; op: Op; time: TimeSpec };

export type TimeSpec = { kind: "none" } | { kind: "now" } | { kind: "days"; days: number } | { kind: "months"; months: number };

export type Expr =
  | { type: "cond"; cond: Condition; negated: boolean }
  | { type: "and" | "or"; items: Expr[] };

export type SortField = "scheduled" | "deadline" | "closed" | "priority" | "state";

export interface Sort {
  field: SortField;
  descending: boolean;
}

export interface Query {
  filter: Expr | null;
  sort: Sort[];
  agendaDays: number | null;
}

const OPS = new Set(["eq", "ne", "lt", "le", "gt", "ge"]);
const DATE_FIELDS: Record<string, "scheduled" | "deadline" | "closed"> = { s: "scheduled", d: "deadline", c: "closed" };
const SORT_FIELDS: Record<string, SortField> = { s: "scheduled", d: "deadline", c: "closed", p: "priority", st: "state" };

export function parseTime(text: string): TimeSpec {
  const t = text.toLowerCase();
  if (t === "none" || t === "no") return { kind: "none" };
  if (t === "now") return { kind: "now" };
  if (t === "today" || t === "tod") return { kind: "days", days: 0 };
  if (t === "tomorrow" || t === "tmrw" || t === "tom") return { kind: "days", days: 1 };
  if (t === "yesterday") return { kind: "days", days: -1 };
  const m = /^(-?\d+)([dwmy])$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === "d") return { kind: "days", days: n };
    if (m[2] === "w") return { kind: "days", days: n * 7 };
    if (m[2] === "m") return { kind: "months", months: n };
    return { kind: "months", months: n * 12 };
  }
  throw new QueryError(`Unknown time "${text}"`);
}

/** One search term, e.g. "s.le.tomorrow" or ".it.done". */
export function parseCondition(term: string): { cond: Condition; negated: boolean } {
  const negated = term.startsWith(".");
  const t = negated ? term.slice(1) : term;
  const dot = t.indexOf(".");
  if (dot < 0) throw new QueryError(`Unknown search term "${term}"`);
  const prefix = t.slice(0, dot).toLowerCase();
  const rest = t.slice(dot + 1);
  if (prefix === "it") {
    const which = rest.toLowerCase();
    if (which === "todo" || which === "done" || which === "none") return { cond: { type: "state", which }, negated };
    throw new QueryError(`Unknown state "${rest}"`);
  }
  if (prefix === "i") {
    if (!rest) throw new QueryError(`Missing keyword in "${term}"`);
    return { cond: { type: "keyword", keyword: rest.toUpperCase() }, negated };
  }
  const field = DATE_FIELDS[prefix];
  if (field) {
    const parts = rest.split(".");
    let op: Op = field === "closed" ? "eq" : "le";
    if (parts.length === 2 && OPS.has(parts[0].toLowerCase())) op = parts.shift()!.toLowerCase() as Op;
    if (parts.length !== 1 || !parts[0]) throw new QueryError(`Can't read "${term}"`);
    return { cond: { type: "date", field, op, time: parseTime(parts[0]) }, negated };
  }
  throw new QueryError(`Unknown search term "${term}"`);
}

function tokenize(src: string): string[] {
  if (/[&|]/.test(src)) throw new QueryError('Use "and" and "or" instead of "&" and "|"');
  return src.replace(/[()]/g, " $& ").split(/\s+/).filter(Boolean);
}

/** Parse a query string. Throws QueryError with a readable message. */
export function parseQuery(src: string): Query {
  const tokens = tokenize(src);
  const sort: Sort[] = [];
  let agendaDays: number | null = null;
  let pos = 0;

  const isOperand = (t: string | undefined) => t !== undefined && t !== ")" && t.toLowerCase() !== "or" && t.toLowerCase() !== "and";

  // sorting and agenda terms are not conditions: take them out of the expression
  const term = (): Expr | null => {
    const t = tokens[pos++];
    if (t === "(") {
      const inner = orExpr();
      if (tokens[pos++] !== ")") throw new QueryError("Missing )");
      return inner;
    }
    const lower = t.toLowerCase();
    const sortMatch = /^(\.?)o\.(\w+)$/.exec(lower);
    if (sortMatch) {
      const field = SORT_FIELDS[sortMatch[2]];
      if (!field) throw new QueryError(`Unknown sort "${t}"`);
      sort.push({ field, descending: sortMatch[1] === "." });
      return null;
    }
    const ad = /^ad\.(\d+)$/.exec(lower);
    if (ad) {
      agendaDays = Number(ad[1]);
      return null;
    }
    const { cond, negated } = parseCondition(t);
    return { type: "cond", cond, negated };
  };

  const andExpr = (): Expr | null => {
    const items: Expr[] = [];
    while (isOperand(tokens[pos]) || tokens[pos]?.toLowerCase() === "and") {
      if (tokens[pos].toLowerCase() === "and") {
        pos++;
        continue;
      }
      const e = term();
      if (e) items.push(e);
    }
    if (!items.length) return null;
    return items.length === 1 ? items[0] : { type: "and", items };
  };

  const orExpr = (): Expr | null => {
    const items: Expr[] = [];
    const first = andExpr();
    if (first) items.push(first);
    while (tokens[pos]?.toLowerCase() === "or") {
      pos++;
      const next = andExpr();
      if (next) items.push(next);
    }
    if (!items.length) return null;
    return items.length === 1 ? items[0] : { type: "or", items };
  };

  const filter = orExpr();
  if (pos < tokens.length) throw new QueryError(`Unexpected "${tokens[pos]}"`);
  return { filter, sort, agendaDays };
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function targetTime(time: TimeSpec, now: Date): number {
  if (time.kind === "now") return now.getTime();
  if (time.kind === "days") return new Date(now.getFullYear(), now.getMonth(), now.getDate() + time.days).getTime();
  if (time.kind === "months") return new Date(now.getFullYear(), now.getMonth() + time.months, now.getDate()).getTime();
  return 0;
}

function compare(a: number, b: number, op: Op): boolean {
  switch (op) {
    case "eq": return a === b;
    case "ne": return a !== b;
    case "lt": return a < b;
    case "le": return a <= b;
    case "gt": return a > b;
    case "ge": return a >= b;
  }
}

export function matchCondition(cond: Condition, task: OrgTask, now: Date): boolean {
  switch (cond.type) {
    case "state":
      return cond.which === "todo" ? task.todo : cond.which === "done" ? task.done : task.keyword === null;
    case "keyword":
      return task.keyword?.toUpperCase() === cond.keyword;
    case "date": {
      const date = task[cond.field];
      if (cond.time.kind === "none") return date === null;
      if (!date) return false;
      const value = cond.time.kind === "now" ? date.getTime() : startOfDay(date);
      return compare(value, targetTime(cond.time, now), cond.op);
    }
  }
}

export function matches(expr: Expr | null, task: OrgTask, now: Date): boolean {
  if (!expr) return true;
  if (expr.type === "cond") return matchCondition(expr.cond, task, now) !== expr.negated;
  if (expr.type === "and") return expr.items.every((e) => matches(e, task, now));
  return expr.items.some((e) => matches(e, task, now));
}

export interface SortContext {
  todoKeywords: string[];
  doneKeywords: string[];
  defaultPriority: string;
}

function sortValue(task: OrgTask, field: SortField, ctx: SortContext): number | string | null {
  switch (field) {
    case "scheduled":
    case "deadline":
    case "closed":
      return task[field]?.getTime() ?? null;
    case "priority":
      return (task.priority ?? ctx.defaultPriority).toUpperCase();
    case "state": {
      if (!task.keyword) return null;
      const todo = ctx.todoKeywords.indexOf(task.keyword);
      if (todo >= 0) return todo;
      const done = ctx.doneKeywords.indexOf(task.keyword);
      return done >= 0 ? ctx.todoKeywords.length + done : null;
    }
  }
}

/** Sort by each key in turn; missing values go last; ties keep file order. */
export function sortTasks(tasks: OrgTask[], sort: Sort[], ctx: SortContext): OrgTask[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      for (const { field, descending } of sort) {
        const x = sortValue(a.task, field, ctx);
        const y = sortValue(b.task, field, ctx);
        if (x === y) continue;
        if (x === null) return 1;
        if (y === null) return -1;
        const c = x < y ? -1 : 1;
        return descending ? -c : c;
      }
      return a.index - b.index;
    })
    .map((x) => x.task);
}

export function runQuery(query: Query, tasks: OrgTask[], now: Date, ctx: SortContext): OrgTask[] {
  return sortTasks(tasks.filter((t) => matches(query.filter, t, now)), query.sort, ctx);
}

export interface AgendaItem {
  task: OrgTask;
  /** why it is on this day: its SCHEDULED or DEADLINE date, or a timestamp in its body (AG-2) */
  kind: "scheduled" | "deadline" | "timestamp";
  /** `HH:MM` when the date has a time */
  time: string | null;
  /** for a timestamp, the text before it on its line (`Birthday`) */
  note: string;
}

export interface AgendaDay {
  /** null for the overdue group */
  date: Date | null;
  items: AgendaItem[];
}

const hhmm = (s: Stamp) => (s.timed ? `${String(s.date.getHours()).padStart(2, "0")}:${String(s.date.getMinutes()).padStart(2, "0")}` : null);

/**
 * TASK-5, AG-2: the matching tasks by day for `days` days from today. A task
 * is on each day its SCHEDULED or DEADLINE date falls on, and each active
 * timestamp in its heading or body falls on, repeaters (`+1y`) included.
 * Open tasks scheduled or due before today come first, in an overdue group,
 * once each. Within a day, items with a time come first, by time; the rest
 * keep the tasks' order.
 */
export function agenda(query: Query, tasks: OrgTask[], now: Date, days: number, ctx: SortContext): AgendaDay[] {
  const matching = runQuery(query, tasks, now, ctx);
  const today = startOfDay(now);
  const groups: AgendaDay[] = [];
  const overdue: AgendaItem[] = [];
  for (const task of matching) {
    if (task.done) continue;
    const late = ([["deadline", task.deadlineStamp ?? task.deadline], ["scheduled", task.scheduledStamp ?? task.scheduled]] as const)
      .find(([, s]) => s && startOfDay(s instanceof Date ? s : s.date) < today);
    if (late) overdue.push({ task, kind: late[0], time: null, note: "" });
  }
  if (overdue.length) groups.push({ date: null, items: overdue });
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const items: AgendaItem[] = [];
    for (const task of matching) {
      for (const kind of ["scheduled", "deadline"] as const) {
        const stamp = task[`${kind}Stamp`];
        const date = task[kind];
        const on = stamp ? occursOn(stamp, day) : date !== null && startOfDay(date) === day.getTime();
        if (on) items.push({ task, kind, time: stamp ? hhmm(stamp) : null, note: "" });
      }
      for (const s of task.stamps ?? []) {
        if (occursOn(s.stamp, day)) items.push({ task, kind: "timestamp", time: hhmm(s.stamp), note: s.note });
      }
    }
    const timed = items.filter((x) => x.time !== null).sort((a, b) => (a.time! < b.time! ? -1 : a.time! > b.time! ? 1 : 0));
    groups.push({ date: day, items: [...timed, ...items.filter((x) => x.time === null)] });
  }
  return groups;
}

const OVERDUE: Record<string, string> = {
  en: "Overdue", de: "Überfällig", fr: "En retard", es: "Atrasado", it: "In ritardo", pt: "Atrasado",
  nl: "Achterstallig", ru: "Просрочено", ja: "期限切れ", zh: "逾期", ko: "기한 지남", pl: "Zaległe", sv: "Försenat",
};

/** "Overdue" in the user's language, English if unknown. */
export function overdueLabel(locale: string): string {
  return OVERDUE[locale.toLowerCase().split(/[-_]/)[0]] ?? OVERDUE.en;
}
