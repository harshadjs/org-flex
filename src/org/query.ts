// A subset of Orgzly's search language (TASK-4), for the Markdown task list.
//
//   it.todo it.done it.none i.<keyword>      state (`.` in front negates)
//   s. d. c. [eq|ne|lt|le|gt|ge.]<time>      scheduled, deadline, closed
//   o.s o.d o.c o.p o.st (.o.x descending)   sorting
//   ad.N                                     agenda of N days
//   and, or, space (and), parentheses

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

export interface AgendaDay {
  /** null for the overdue group */
  date: Date | null;
  tasks: OrgTask[];
}

/**
 * TASK-5: tasks grouped by day for `days` days from today; open tasks
 * scheduled or due before today go into a first, overdue group.
 */
export function agenda(query: Query, tasks: OrgTask[], now: Date, days: number, ctx: SortContext): AgendaDay[] {
  const matching = runQuery(query, tasks, now, ctx);
  const today = startOfDay(now);
  const groups: AgendaDay[] = [];
  const overdue = matching.filter((t) => !t.done && [t.scheduled, t.deadline].some((d) => d && startOfDay(d) < today));
  if (overdue.length) groups.push({ date: null, tasks: overdue });
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const time = day.getTime();
    const onDay = matching.filter((t) => [t.scheduled, t.deadline].some((d) => d && startOfDay(d) === time));
    groups.push({ date: day, tasks: onDay });
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
