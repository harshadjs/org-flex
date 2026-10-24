# Journal days with the date as ID

> "My Emacs org-roam setup links days as [[id:2026-10-23]], and my old journal files are tagged :journal:."

## Ask
- The exact header their Emacs makes for a new day: the `org-roam-dailies-capture-templates` or `org-journal` settings, or one existing day file.
- The folder layout (`journal/YYYY/MM/` or flat) and the file name format.

## Spec
- **JRN-2:** the template becomes `:ID: {{date}}` with `#+filetags: :journal:`; say why (org-roam links days by date).
- **JRN-1**, only if the layout differs: rewrite the path rule.

## Code
- `src/flavour.ts`: set `journalTemplate`, for example `":PROPERTIES:\n:ID:       {{date}}\n:END:\n#+title: {{date}}\n#+filetags: :journal:\n\n"`.
- `src/org/journal.ts` (`journalPathForDate`, `journalEntries`): only if the layout changes.

## Tests
- `test/notes.spec.ts`: "the base flavour has only TODO and DONE, and the UUID journal header" becomes a test of this flavour's header.
- `test/notes.spec.ts`: "journalFileContent fills the template's date and ID" stays as it is.
- **Manual**, a §16 line: a new day opened in Org Flex is found by Emacs's `org-roam-dailies-goto-date`.
