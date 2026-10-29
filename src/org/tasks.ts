// Org tasks for the Markdown task list (§11): every heading with its keyword,
// priority and planning dates.

import { isPlanningLine, Keywords, parseHeading } from "./syntax";
import { applyEdits, parseStamp, taskStateEdits, type Stamp, type TaskLog } from "./repeat";

export interface OrgTask {
  /** 0-based line of the heading */
  line: number;
  level: number;
  keyword: string | null;
  /** keyword is one of the done keywords */
  done: boolean;
  /** keyword is one of the todo keywords */
  todo: boolean;
  priority: string | null;
  title: string;
  scheduled: Date | null;
  deadline: Date | null;
  closed: Date | null;
  /** the SCHEDULED and DEADLINE timestamps, with their repeaters (AG-2, TASK-5) */
  scheduledStamp: Stamp | null;
  deadlineStamp: Stamp | null;
  /** AG-2: active timestamps in the heading and its body (not the planning line) */
  stamps: TaskStamp[];
  /** the file it is in, when tasks of several files are listed together (AG-1) */
  path?: string;
}

export interface TaskStamp {
  stamp: Stamp;
  /** 0-based line it is on */
  line: number;
  /** the text before it on its line, without a list bullet or a final `:` (`- Birthday: <…>` → `Birthday`) */
  note: string;
}

const STAMP_RE = /(SCHEDULED|DEADLINE|CLOSED):[ \t]*[<\[](\d{4})-(\d{2})-(\d{2})(?:[ \t]+\p{L}+)?(?:[ \t]+(\d{1,2}):(\d{2}))?[^>\]]*[>\]]/gu;

type PlanningDates = Pick<OrgTask, "scheduled" | "deadline" | "closed" | "scheduledStamp" | "deadlineStamp">;
const NO_DATES: PlanningDates = { scheduled: null, deadline: null, closed: null, scheduledStamp: null, deadlineStamp: null };

function planningDates(text: string): PlanningDates {
  const dates = { ...NO_DATES };
  STAMP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STAMP_RE.exec(text))) {
    const date = new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]), m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
    const key = m[1].toLowerCase() as "scheduled" | "deadline" | "closed";
    dates[key] = date;
    if (key !== "closed" && m[0].includes("<")) dates[`${key}Stamp`] = parseStamp(m[0]);
  }
  return dates;
}

const ACTIVE_RE = /<\d{4}-\d{2}-\d{2}[^>\n]*>/g;

/** AG-2: the active timestamps on a line, each with the text between it and the one before. */
function lineStamps(text: string, line: number): TaskStamp[] {
  const out: TaskStamp[] = [];
  let after = 0;
  for (const m of text.matchAll(ACTIVE_RE)) {
    const stamp = parseStamp(m[0]);
    const before = text.slice(after, m.index);
    after = m.index + m[0].length;
    if (!stamp) continue;
    const note = before.replace(/^[ \t]*(?:and|or|,)[ \t]+/, "").replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/, "").replace(/[\s:–—-]+$/, "").trim();
    out.push({ stamp, line, note });
  }
  return out;
}

/** TASK-2: every heading, at any depth, with its planning line. */
export function parseTasks(text: string, keywords: Keywords): OrgTask[] {
  const lines = text.split("\n");
  const tasks: OrgTask[] = [];
  for (let n = 0; n < lines.length; n++) {
    const parts = parseHeading(lines[n], keywords);
    if (!parts) continue;
    const kw = parts.keyword?.text ?? null;
    const hasPlanning = n + 1 < lines.length && isPlanningLine(lines[n + 1]);
    const planning = hasPlanning ? planningDates(lines[n + 1]) : NO_DATES;
    const stamps = lineStamps(lines[n].slice(parts.title.from, parts.title.to), n).map((s) => ({ ...s, note: "" }));
    for (let b = hasPlanning ? n + 2 : n + 1; b < lines.length && !parseHeading(lines[b], keywords); b++) {
      if (lines[b].includes("<")) stamps.push(...lineStamps(lines[b], b));
    }
    tasks.push({
      line: n,
      level: parts.level,
      keyword: kw,
      done: kw !== null && keywords.done.includes(kw),
      todo: kw !== null && keywords.todo.includes(kw),
      priority: parts.priority?.value.toUpperCase() ?? null,
      title: lines[n].slice(parts.title.from, parts.title.to),
      ...planning,
      stamps,
    });
  }
  return tasks;
}

/**
 * TASK-3: the file text with the task's keyword flipped: done → TODO,
 * anything else → DONE, logged as ACT-14 and ACT-15 say. Null if the heading is no longer where it was.
 */
export function toggleTaskInText(text: string, task: OrgTask, keywords: Keywords, log: TaskLog = { now: new Date(), logDone: false }): string | null {
  const lines = text.split("\n");
  const parts = parseHeading(lines[task.line] ?? "", keywords);
  if (!parts || lines[task.line].slice(parts.title.from, parts.title.to) !== task.title) return null;
  const next = task.done ? "TODO" : "DONE";
  return applyEdits(text, taskStateEdits(text, task.line, next, keywords, log));
}

/** TASK-1: the block's settings from its parsed YAML; `filepath:` is required. */
export function taskBlockConfig(yaml: unknown): { filepath: string; query: string } {
  const config = (yaml && typeof yaml === "object" ? yaml : {}) as Record<string, unknown>;
  if (typeof config.filepath !== "string" || !config.filepath.trim()) throw new Error("filepath: is required");
  const query = config.query === undefined || config.query === null ? "it.todo or it.done" : String(config.query);
  return { filepath: config.filepath.trim(), query };
}
