import { describe, expect, test } from "vitest";
import { parseTasks, taskBlockConfig, toggleTaskInText } from "../src/org/tasks";
import { agenda, overdueLabel, parseQuery, QueryError, runQuery } from "../src/org/query";

const kw = { todo: ["TODO", "NEXT"], done: ["DONE", "CANCELLED"] };
const ctx = { todoKeywords: kw.todo, doneKeywords: kw.done, defaultPriority: "B" };
const now = new Date(2024, 0, 10, 12, 0);

const file = [
  "* TODO [#A] Write report",
  "SCHEDULED: <2024-01-09 Tue> DEADLINE: <2024-01-12 Fri 10:00>",
  "** NEXT Sub task",
  "SCHEDULED: <2024-01-10 Wed>",
  "* DONE Old thing",
  "CLOSED: [2024-01-08 Mon 09:00]",
  "* Just a heading",
  "* CANCELLED [#C] Dropped",
  "*** TODO Deep",
  "  DEADLINE: <2024-01-11 Thu>",
].join("\n");

const tasks = parseTasks(file, kw);
const titles = (q: string) => runQuery(parseQuery(q), tasks, now, ctx).map((t) => t.title);

describe("tasks", () => {
  test("headings at any depth with keyword, priority and planning dates", () => {
    expect(tasks.map((t) => [t.level, t.keyword, t.priority, t.title])).toEqual([
      [1, "TODO", "A", "Write report"],
      [2, "NEXT", null, "Sub task"],
      [1, "DONE", null, "Old thing"],
      [1, null, null, "Just a heading"],
      [1, "CANCELLED", "C", "Dropped"],
      [3, "TODO", null, "Deep"],
    ]);
    expect(tasks[0].scheduled).toEqual(new Date(2024, 0, 9));
    expect(tasks[0].deadline).toEqual(new Date(2024, 0, 12, 10, 0));
    expect(tasks[2].closed).toEqual(new Date(2024, 0, 8, 9, 0));
    expect(tasks[5].deadline).toEqual(new Date(2024, 0, 11));
  });

  test("ticking flips done tasks to TODO and anything else to DONE", () => {
    expect(toggleTaskInText(file, tasks[0], kw)!.split("\n")[0]).toBe("* DONE [#A] Write report");
    expect(toggleTaskInText(file, tasks[4], kw)!.split("\n")[7]).toBe("* TODO [#C] Dropped");
    expect(toggleTaskInText("* moved", tasks[0], kw)).toBeNull();
  });
});

describe("queries", () => {
  test("state conditions and negation", () => {
    expect(titles("it.todo")).toEqual(["Write report", "Sub task", "Deep"]);
    expect(titles("it.done")).toEqual(["Old thing", "Dropped"]);
    expect(titles(".it.done i.todo")).toEqual(["Write report", "Deep"]);
    expect(titles("it.none")).toEqual(["Just a heading"]);
  });

  test("date conditions with operators and times", () => {
    expect(titles("s.today")).toEqual(["Write report", "Sub task"]);
    expect(titles("s.eq.yesterday")).toEqual(["Write report"]);
    expect(titles("d.le.1d")).toEqual(["Deep"]);
    expect(titles("d.ge.2d")).toEqual(["Write report"]);
    expect(titles("c.eq.-2d")).toEqual(["Old thing"]);
    expect(titles("it.todo s.none")).toEqual(["Deep"]);
    expect(titles("d.lt.1w and it.todo")).toEqual(["Write report", "Deep"]);
  });

  test("and, or and parentheses", () => {
    expect(titles("(i.next or i.cancelled) or it.none")).toEqual(["Sub task", "Just a heading", "Dropped"]);
    expect(titles("it.todo and (s.today or d.tomorrow)")).toEqual(["Write report", "Sub task", "Deep"]);
  });

  test("sorting", () => {
    expect(titles("it.todo or it.done o.p")).toEqual(["Write report", "Sub task", "Old thing", "Deep", "Dropped"]);
    expect(titles("it.todo .o.s")).toEqual(["Sub task", "Write report", "Deep"]);
    expect(titles("it.todo or it.done o.st")).toEqual(["Write report", "Deep", "Sub task", "Old thing", "Dropped"]);
  });

  test("bad queries say why", () => {
    expect(() => parseQuery("it.todo & it.done")).toThrow(QueryError);
    expect(() => parseQuery("it.todo | it.done")).toThrow(QueryError);
    expect(() => parseQuery("x.y")).toThrow(/Unknown/);
    expect(() => parseQuery("s.soon")).toThrow(/Unknown time/);
    expect(() => parseQuery("(it.todo")).toThrow(/Missing/);
  });

  test("agenda groups tasks by day, overdue first", () => {
    const q = parseQuery("it.todo ad.3");
    expect(q.agendaDays).toBe(3);
    const days = agenda(q, tasks, now, 3, ctx);
    expect(days.map((d) => [d.date && d.date.getDate(), d.tasks.map((t) => t.title)])).toEqual([
      [null, ["Write report"]],
      [10, ["Sub task"]],
      [11, ["Deep"]],
      [12, ["Write report"]],
    ]);
    expect(overdueLabel("de-DE")).toBe("Überfällig");
    expect(overdueLabel("xx")).toBe("Overdue");
  });
});

test("a task block needs filepath: and defaults its query", () => {
  expect(taskBlockConfig({ filepath: " tasks.org " })).toEqual({ filepath: "tasks.org", query: "it.todo or it.done" });
  expect(taskBlockConfig({ filepath: "t.org", query: "it.todo o.p" })).toEqual({ filepath: "t.org", query: "it.todo o.p" });
  expect(() => taskBlockConfig({ query: "it.todo" })).toThrow("filepath: is required");
  expect(() => taskBlockConfig(null)).toThrow("filepath: is required");
});
