# GTD keywords

> "I use TODO, NEXT and WAITING, and close things as DONE or CANCELLED. I want one tap to mark something NEXT."

## Ask
- The open keywords in the order they cycle, and the done ones. Do they put them in each file as `#+TODO:` lines (Emacs), or are they the same everywhere?
- Should the task button cycle through every keyword, or stay none → TODO → DONE (ACT-3) with NEXT on a button of its own?

## Spec
- **§12a:** `todoKeywords` becomes `TODO, NEXT, WAITING`; `doneKeywords` becomes `DONE, CANCELLED`.
- **ACT-3**, if the person wants every keyword in the cycle: none → TODO → NEXT → WAITING → DONE → CANCELLED → none.
- **New ACT-n**, "Mark NEXT": a `next` button and the command `org-mark-next` set the heading's keyword to NEXT, or turn a plain line into `* NEXT …`.
- **BAR-2 and BAR-3:** add the `next` button to the order and the default list.
- **§9.3:** add the command.

## Code
- `src/flavour.ts`: the keyword lists.
- `src/org/edit.ts`: `setKeyword(state, keyword, keywords)`, the pure edit.
- `src/settings.ts`: `{ id: "next", … }` in `BUTTONS` and `"next"` in `CORE_BUTTONS`.
- `src/view.ts`: the `next` case in `runButton`.
- `src/main.ts`: `inView("org-mark-next", …)`.
- `test/invariants.spec.ts`: `"org-mark-next"` added to `SHIPPED_COMMAND_IDS`.

## Tests
- `test/edit.spec.ts`: "setKeyword sets NEXT on a heading, replaces another keyword and turns text into a heading".
- `test/notes.spec.ts`: the flavour test, updated to the new lists.
- The existing ACT-3 tests, updated if the cycle changed.
- **Manual**, a §16 line: the button sets NEXT on the phone without the keyboard coming up.
