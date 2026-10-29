// Org tasks for the Markdown task list (§11): every heading with its keyword,
// priority and planning dates.

import { isPlanningLine, Keywords, parseHeading } from "./syntax";
import { applyEdits, taskStateEdits, type TaskLog } from "./repeat";

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
}

const STAMP_RE = /(SCHEDULED|DEADLINE|CLOSED):[ \t]*[<\[](\d{4})-(\d{2})-(\d{2})(?:[ \t]+\p{L}+)?(?:[ \t]+(\d{1,2}):(\d{2}))?[^>\]]*[>\]]/gu;

function planningDates(text: string): Pick<OrgTask, "scheduled" | "deadline" | "closed"> {
  const dates: Pick<OrgTask, "scheduled" | "deadline" | "closed"> = { scheduled: null, deadline: null, closed: null };
  STAMP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STAMP_RE.exec(text))) {
    const date = new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]), m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
    const key = m[1].toLowerCase() as "scheduled" | "deadline" | "closed";
    dates[key] = date;
  }
  return dates;
}

/** TASK-2: every heading, at any depth, with its planning line. */
export function parseTasks(text: string, keywords: Keywords): OrgTask[] {
  const lines = text.split("\n");
  const tasks: OrgTask[] = [];
  for (let n = 0; n < lines.length; n++) {
    const parts = parseHeading(lines[n], keywords);
    if (!parts) continue;
    const kw = parts.keyword?.text ?? null;
    const planning = n + 1 < lines.length && isPlanningLine(lines[n + 1]) ? planningDates(lines[n + 1]) : { scheduled: null, deadline: null, closed: null };
    tasks.push({
      line: n,
      level: parts.level,
      keyword: kw,
      done: kw !== null && keywords.done.includes(kw),
      todo: kw !== null && keywords.todo.includes(kw),
      priority: parts.priority?.value.toUpperCase() ?? null,
      title: lines[n].slice(parts.title.from, parts.title.to),
      ...planning,
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
