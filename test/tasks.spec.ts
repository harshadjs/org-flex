import { describe, expect, test } from "vitest";
import { parseTasks, taskBlockConfig, toggleTaskInText } from "../src/org/tasks";
import { agenda, overdueLabel, parseQuery, QueryError, runQuery } from "../src/org/query";
import { AGENDA_DAYS, AGENDA_QUERY, agendaFiles, cellTitles, chosenDay, dayOffset, monthGrid, monthStart, relativeDay, weekSpanStart } from "../src/org/agenda";

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
    expect(days.map((d) => [d.date && d.date.getDate(), d.items.map((i) => i.task.title)])).toEqual([
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

test("the agenda reads the top-level org files and shows the week: overdue, then each day with times first", () => {
  expect(agendaFiles(["tasks.org", "notes/x.org", "people.org", "README.md", "Inbox.ORG"])).toEqual(["Inbox.ORG", "people.org", "tasks.org"]);
  const kw2 = { todo: ["TODO", "IN-PROGRESS", "WAITING"], done: ["DONE", "CANCELLED"] };
  const thu = new Date(2026, 9, 29, 9, 0);
  const people = parseTasks([
    "* [[id:1][Dani]]",
    ":PROPERTIES:",
    ":ID: 1",
    ":END:",
    "- Birthday: <1990-10-31 Wed +1y>",
    "* Sam",
    "Anniversary <2015-11-04 Wed +1y> and a call <2026-10-29 Thu 18:30>",
  ].join("\n"), kw2).map((t) => ({ ...t, path: "people.org" }));
  const todo = parseTasks([
    "* TODO Pay rent",
    "DEADLINE: <2026-10-01 Thu +1m>",
    "* IN-PROGRESS Late report",
    "SCHEDULED: <2026-10-27 Tue>",
    "* DONE Old",
    "SCHEDULED: <2026-10-29 Thu>",
    "* WAITING Dentist",
    "SCHEDULED: <2026-10-29 Thu 08:00>",
  ].join("\n"), kw2).map((t) => ({ ...t, path: "tasks.org" }));
  const days = agenda(parseQuery(AGENDA_QUERY), [...people, ...todo], thu, AGENDA_DAYS, { todoKeywords: kw2.todo, doneKeywords: kw2.done, defaultPriority: "B" });
  const show = days.map((d) => [d.date?.getDate() ?? "overdue", d.items.map((i) => `${i.time ?? ""} ${i.task.title} ${i.kind} ${i.note}`.trim())]);
  expect(show).toEqual([
    ["overdue", ["Pay rent deadline", "Late report scheduled"]],
    [29, ["08:00 Dentist scheduled", "18:30 Sam timestamp a call"]],
    [30, []],
    [31, ["[[id:1][Dani]] timestamp Birthday"]],
    [1, ["Pay rent deadline"]],
    [2, []],
    [3, []],
    [4, ["Sam timestamp Anniversary"]],
  ]);
});

test("the agenda shows any 7 days from a start, overdue only when they include today", () => {
  const kw = { todo: ["TODO"], done: ["DONE"] };
  const tasks = parseTasks([
    "* TODO Late", "SCHEDULED: <2026-11-01 Sun>",
    "* TODO Next week", "SCHEDULED: <2026-11-20 Fri>",
    "* TODO Last week", "DEADLINE: <2026-11-06 Fri>",
  ].join("\n"), kw).map((t) => ({ ...t, path: "tasks.org" }));
  const ctx = { todoKeywords: kw.todo, doneKeywords: kw.done, defaultPriority: "B" };
  const today = new Date(2026, 10, 12, 9, 0);
  const show = (start: Date) => agenda(parseQuery(AGENDA_QUERY), tasks, today, AGENDA_DAYS, ctx, start)
    .filter((d) => d.items.length).map((d) => [d.date?.getDate() ?? "overdue", d.items.map((i) => i.task.title)]);
  expect(weekSpanStart(today, 1)).toEqual(new Date(2026, 10, 19));
  expect(weekSpanStart(today, -1)).toEqual(new Date(2026, 10, 5));
  expect(show(weekSpanStart(today, 0))).toEqual([["overdue", ["Late", "Last week"]]]);
  expect(show(weekSpanStart(today, 1))).toEqual([[20, ["Next week"]]]);
  // a past week: its own items, no overdue group
  expect(show(weekSpanStart(today, -1))).toEqual([[6, ["Last week"]]]);
});

test("a month grid is Monday-start weeks covering the month", () => {
  const today = new Date(2026, 10, 12);
  expect(monthStart(today, 0)).toEqual(new Date(2026, 10, 1));
  expect(monthStart(today, 2)).toEqual(new Date(2027, 0, 1));
  expect(monthStart(today, -11)).toEqual(new Date(2025, 11, 1));
  // November 2026 starts on a Sunday: from Monday 26 October to Sunday 6 December
  const nov = monthGrid(new Date(2026, 10, 1));
  expect(nov.length).toBe(42);
  expect(nov[0]).toEqual(new Date(2026, 9, 26));
  expect(nov[41]).toEqual(new Date(2026, 11, 6));
  expect(nov.every((d) => d.getHours() === 0)).toBe(true);
  // February 2027 starts on a Monday and ends on a Sunday: four whole weeks
  const feb = monthGrid(new Date(2027, 1, 1));
  expect([feb.length, feb[0], feb[27]]).toEqual([28, new Date(2027, 1, 1), new Date(2027, 1, 28)]);
  expect(nov.slice(0, 7).map((d) => d.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
});

test("the month view starts on today when the month holds it, else on the 1st", () => {
  const today = new Date(2026, 10, 12, 15, 30);
  expect(chosenDay(null, new Date(2026, 10, 1), today)).toEqual(new Date(2026, 10, 12));
  expect(chosenDay(null, new Date(2026, 11, 1), today)).toEqual(new Date(2026, 11, 1));
  expect(chosenDay(new Date(2026, 11, 24), new Date(2026, 11, 1), today)).toEqual(new Date(2026, 11, 24));
  // a day chosen in another month doesn't carry over
  expect(chosenDay(new Date(2026, 10, 3), new Date(2026, 11, 1), today)).toEqual(new Date(2026, 11, 1));
});

test("a month cell shows two titles, then how many more", () => {
  expect(cellTitles(["A", "B", "C", "D"])).toEqual({ shown: ["A", "B"], more: 2 });
  expect(cellTitles(["A"])).toEqual({ shown: ["A"], more: 0 });
  expect(cellTitles([])).toEqual({ shown: [], more: 0 });
});

test("agenda days are counted by the calendar and named relative to today", () => {
  const today = new Date(2026, 9, 30, 23, 59);
  expect(dayOffset(new Date(2026, 9, 30, 0, 0), today)).toBe(0);
  expect(dayOffset(new Date(2026, 9, 31, 0, 1), today)).toBe(1);
  expect(dayOffset(new Date(2026, 9, 27), today)).toBe(-3);
  // across the end of summer time (25 October 2026 in Europe) and a month end
  expect(dayOffset(new Date(2026, 10, 2), new Date(2026, 9, 24))).toBe(9);
  expect([0, 1, -3].map((n) => relativeDay(n, "en"))).toEqual(["today", "tomorrow", "3 days ago"]);
  expect(relativeDay(1, "de")).toBe("morgen");
  expect(relativeDay(0, "not a locale!")).toBe("today");
});
