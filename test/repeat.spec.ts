import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { cycleTaskState, toggleKeyword } from "../src/org/edit";
import { addRepeat, nextRepeat, occursOn, parseStamp } from "../src/org/repeat";
import { parseTasks, toggleTaskInText } from "../src/org/tasks";

const kw = { todo: ["TODO", "WAITING"], done: ["DONE", "CANCELLED"] };
// Thu 29 Oct 2026, 09:12
const now = new Date(2026, 9, 29, 9, 12);
const log = { now, logDone: true };

function cycle(doc: string, line = 0, l = log) {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(EditorState.create({ doc }).doc.line(line + 1).to) });
  return s.update(cycleTaskState(s, kw, l)!).state;
}

describe("CLOSED and repeating tasks", () => {
  test("cycling to DONE adds CLOSED with the time, before SCHEDULED, and cycling away removes it", () => {
    expect(cycle("* TODO Pay\nSCHEDULED: <2026-10-30 Fri>\nbody").doc.toString())
      .toBe("* DONE Pay\nCLOSED: [2026-10-29 Thu 09:12] SCHEDULED: <2026-10-30 Fri>\nbody");
    expect(cycle("* DONE Pay\nCLOSED: [2026-10-29 Thu 09:12] SCHEDULED: <2026-10-30 Fri>\nbody").doc.toString())
      .toBe("* Pay\nSCHEDULED: <2026-10-30 Fri>\nbody");
    // a planning line with only CLOSED goes with it
    expect(cycle("* DONE Pay\nCLOSED: [2026-10-29 Thu 09:12]\nbody").doc.toString()).toBe("* Pay\nbody");
    // without logDone, DONE is only the keyword, but leaving it still removes CLOSED
    expect(cycle("* TODO Pay\nbody", 0, { now, logDone: false }).doc.toString()).toBe("* DONE Pay\nbody");
    expect(cycle("* DONE Pay\nCLOSED: [2026-10-29 Thu 09:12]", 0, { now, logDone: false }).doc.toString()).toBe("* Pay");
  });

  test("a heading without a planning line gets one for CLOSED, and the cursor stays on the heading", () => {
    const s = cycle("* WAITING [#A] Call :work:\ntext");
    expect(s.doc.toString()).toBe("* DONE [#A] Call :work:\nCLOSED: [2026-10-29 Thu 09:12]\ntext");
    expect(s.selection.main.head).toBe("* DONE [#A] Call :work:".length);
  });

  test("toggleKeyword and task blocks log CLOSED too", () => {
    const s = EditorState.create({ doc: "* TODO a\n* DONE b\nCLOSED: [2026-10-01 Thu 08:00]" });
    expect(s.update(toggleKeyword(s, 2, kw, log)!).state.doc.toString())
      .toBe("* DONE a\nCLOSED: [2026-10-29 Thu 09:12]\n* DONE b\nCLOSED: [2026-10-01 Thu 08:00]");
    const t = s.update(toggleKeyword(s, 11, kw, log)!).state.doc.toString();
    expect(t).toBe("* TODO a\n* TODO b");
    const file = "* TODO a\n  SCHEDULED: <2026-10-30 Fri>";
    expect(toggleTaskInText(file, parseTasks(file, kw)[0], kw, log)).toBe("* DONE a\n  CLOSED: [2026-10-29 Thu 09:12] SCHEDULED: <2026-10-30 Fri>");
  });

  test("marking a repeating task done moves its dates, sets LAST_REPEAT and logs the state, as Emacs does", () => {
    expect(cycle("* TODO Water plants\nSCHEDULED: <2026-10-27 Tue +1w>\nnotes").doc.toString()).toBe([
      "* TODO Water plants",
      "SCHEDULED: <2026-11-03 Tue +1w>",
      ":PROPERTIES:",
      ":LAST_REPEAT: [2026-10-29 Thu 09:12]",
      ":END:",
      '- State "DONE"       from "TODO"       [2026-10-29 Thu 09:12]',
      "notes",
    ].join("\n"));
    // an existing drawer gets the property; the note goes after every drawer; the keyword stays
    expect(cycle([
      "* WAITING Review",
      "DEADLINE: <2026-10-20 Tue 10:00 ++1w> SCHEDULED: <2026-10-01 Thu .+2d>",
      ":PROPERTIES:",
      ":ID: 1",
      ":LAST_REPEAT: [2026-10-13 Tue 10:00]",
      ":END:",
      ":LOGBOOK:",
      "CLOCK: x",
      ":END:",
    ].join("\n")).doc.toString()).toBe([
      "* WAITING Review",
      "DEADLINE: <2026-11-03 Tue 10:00 ++1w> SCHEDULED: <2026-10-31 Sat .+2d>",
      ":PROPERTIES:",
      ":ID: 1",
      ":LAST_REPEAT: [2026-10-29 Thu 09:12]",
      ":END:",
      ":LOGBOOK:",
      "CLOCK: x",
      ":END:",
      '- State "DONE"       from "WAITING"    [2026-10-29 Thu 09:12]',
    ].join("\n"));
    // a drawer with no LAST_REPEAT gets one at its end
    expect(cycle("* TODO x\nSCHEDULED: <2026-10-29 Thu +1d>\n:PROPERTIES:\n:ID: 1\n:END:").doc.toString())
      .toBe('* TODO x\nSCHEDULED: <2026-10-30 Fri +1d>\n:PROPERTIES:\n:ID: 1\n:LAST_REPEAT: [2026-10-29 Thu 09:12]\n:END:\n- State "DONE"       from "TODO"       [2026-10-29 Thu 09:12]');
  });

  test("repeaters: + one step, ++ until after now, .+ from today; months keep the day", () => {
    const s = (t: string) => parseStamp(t)!;
    expect(s("<2026-10-01 Thu 10:00 +1w>")).toMatchObject({ timed: true, repeat: { kind: "+", n: 1, unit: "w" } });
    expect(s("<2026-10-01 Thu>").repeat).toBeNull();
    expect(nextRepeat(s("<2026-01-01 Thu +1m>"), now)).toEqual(new Date(2026, 1, 1));
    expect(nextRepeat(s("<2026-10-01 Thu ++1w>"), now)).toEqual(new Date(2026, 10, 5));
    expect(nextRepeat(s("<2026-10-29 Thu 08:00 ++1d>"), now)).toEqual(new Date(2026, 9, 30, 8, 0));
    expect(nextRepeat(s("<2026-01-05 Mon .+1y>"), now)).toEqual(new Date(2027, 9, 29));
    expect(nextRepeat(s("<2026-10-29 Thu 08:00 +3h>"), now)).toEqual(new Date(2026, 9, 29, 11, 0));
    expect(addRepeat(new Date(2024, 1, 29), { kind: "+", n: 1, unit: "y" })).toEqual(new Date(2025, 2, 1));
  });

  test("a repeating timestamp falls on every date it repeats to, from its first one", () => {
    const bday = parseStamp("<1990-11-02 Fri +1y>")!;
    expect(occursOn(bday, new Date(2026, 10, 2))).toBe(true);
    expect(occursOn(bday, new Date(2026, 10, 3))).toBe(false);
    expect(occursOn(bday, new Date(1989, 10, 2))).toBe(false);
    const weekly = parseStamp("<2026-10-06 Tue 18:00 +2w>")!;
    expect(occursOn(weekly, new Date(2026, 10, 3))).toBe(true);
    expect(occursOn(weekly, new Date(2026, 9, 27))).toBe(false);
    expect(occursOn(parseStamp("<2026-10-29 Thu>")!, new Date(2026, 9, 29, 15))).toBe(true);
    expect(occursOn(parseStamp("<2026-01-31 Sat +1m>")!, new Date(2026, 2, 3))).toBe(true);
  });
});
