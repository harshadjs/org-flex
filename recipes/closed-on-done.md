# Log CLOSED when a task is done

> "When I mark something DONE I want the time it was closed, like Emacs with org-log-done."

## Ask
- Timestamp or none: `CLOSED: [2026-10-23 Fri 18:04]` (`org-log-done 'time`) is usual.
- Should going back to an open keyword remove `CLOSED:` (Emacs does)?
- Should repeating tasks (`+1w`) move their date forward instead? That is a bigger change, so make it a separate rule.

## Spec
- **ACT-3, ACT-6 and RD-3:** each place that sets a done keyword (cycling, tapping a keyword in reading mode) also writes `CLOSED: [<now>]` into the planning line under the heading. The planning line goes first, before `SCHEDULED:` and `DEADLINE:`, as Org writes it. One is created if there is none. Leaving a done keyword removes `CLOSED:`, and an empty planning line goes with it.
- **TASK-2:** already reads `CLOSED`; check that its tests still pass.
- **Known gaps** (§9): delete "Marking a task done doesn't add `CLOSED:`".

## Code
- `src/org/edit.ts`:
  1. Add a pure `setClosed(state, headingLine, date | null)` next to `setPlanningDate`, reusing its planning-line parsing.
  2. Call it from `cycleTaskState` and `toggleKeyword`, passing `new Date()` in from the view, so the logic stays pure and testable.
  3. Format the timestamp with `orgDateString` plus the time, in square brackets (inactive).

## Tests
- `test/edit.spec.ts`:
  - "cycling to DONE adds CLOSED with the time, before SCHEDULED, and cycling away removes it";
  - "a heading without a planning line gets one for CLOSED";
  - "toggleKeyword logs CLOSED too".
- INV-1 still holds: the fixture round trip doesn't change, since nothing is written on load.
- **Manual**, a §16 line: in Emacs, `org-agenda-log-mode` shows the task closed at that time.
