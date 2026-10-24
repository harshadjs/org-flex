# Drop a feature

> "I never use the journal, and the backlinks at the bottom get in my way."

## Ask
- Which features from `src/features/index.ts` they don't use. Make sure they don't depend on one indirectly: capture's link back to a note needs nothing else, but the journal calendar needs the journal.

## Spec
- Delete the feature's section: §10 for `journal`, §5a's backlinks rules (BL-*) for `backlinks`. Keep the index rules (IDX-*), which are core.
- Remove the feature from PLAT-8's list.
- Remove its commands from §9.3 and its buttons from BAR-2 and BAR-3, and change BAR-8 if it names them.
- Remove its §16 checklist lines and any references from other rules (search for its rule IDs).

## Code
1. Delete its line in `src/features/index.ts` and its file `src/features/<id>.ts`.
2. Delete the pure logic and dialogs only it used. For the journal: `src/org/journal.ts`, `JournalPickerModal` and `JournalCalendarModal` in `src/ui/modals.ts`, and the `journalFolder` setting in `src/settings.ts` (add it to `RETIRED_SETTINGS`), with its settings-tab row.
3. Remove its buttons from `BUTTONS`, or leave them, since a button nothing runs never shows. Removing them is tidier.
4. Move its command ids from `SHIPPED_COMMAND_IDS` to `RETIRED_COMMAND_IDS` in `test/invariants.spec.ts`.

## Tests
- Delete the tests of what you deleted. The type checker and the PLAT-8 guard tests catch anything left behind:
  - "each feature is one file…";
  - "every bar button is run by the core or by exactly one feature".
- **Manual:** none; there is less to check.
