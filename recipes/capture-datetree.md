# Capture into a date tree

> "My captures go under year / month / day headings in inbox.org, like file+olp+datetree."

## Ask
- The heading formats: Emacs's `* 2026`, `** 2026-10 October`, `*** 2026-10-23 Friday`, or their own.
- Whether entries go at the top or the end of the day.
- Whether a captured entry should still be a TODO with a schedule, or a plain note with a timestamp.

## Spec
- **CAP-3:** the entry goes as a child of today's day heading, at the end of its subtree (or at the top). Missing year, month and day headings are created in date order among their siblings. Entries are one level deeper than the day.
- **CAP-5:** still holds; the edit is applied to an open inbox the same way.
- **CAP-1:** the dialog's "At the end of …" line becomes "Under today in …".

## Code
- `src/org/capture.ts`:
  1. Add a pure `datetreeInsert(doc, date, entry)` that returns `{ from, insert }`.
  2. Use the parser (`analyze`) to find or place the year, month and day headings.
  3. Change `captureEntry`'s `*` to the depth it's given.
- `src/features/capture.ts`: use `datetreeInsert` instead of `appendEntry`, both for an open inbox (`appendEntry` in `src/view.ts` becomes `insertEntry(change)`) and on disk.

## Tests
- `test/notes.spec.ts`:
  - "datetreeInsert creates year, month and day in order and nests the entry";
  - "datetreeInsert adds to an existing day at the end of its subtree";
  - "datetreeInsert keeps other years in date order".
- **Manual**, a §16 line: Emacs's `org-capture` with the same date tree adds to the same day heading.
