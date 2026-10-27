# Flavour: harshad

This branch (`harshad`) is the plugin author's own copy, kept on top of the base on `main`. Base work happens on `main` and is merged in here; what's below is committed only on this branch.

## How Org is used
- Org files shared with Emacs (Denote, since 2026-10-26; org-roam before) through Syncthing, edited in Obsidian on an Android phone and on the desktop.
- Tasks, a daily journal, notes linked by Denote identifier, and quick capture on the phone.

## Decisions
- **Keywords:** open `TODO NEXT DOING WAITING`, done `DONE CANCELLED` (2026-10-24). This trims the older list, which also had `PENDING`, `CANCELED`, `CANCEL`, `REJECTED`, `STOP` and `STOPPED`; headings that still use those read as plain titles.
- **Journal:** the base header, with a new UUID as `:ID:` (2026-10-24). Days made earlier keep `:ID: YYYY-MM-DD`.
- **Links:** Denote (`links: "denote"`, 2026-10-26). Notes and media share one series of identifiers: `YYMM` then letters, one after the highest that month (`2610a` … `2610z`, `2610aa` …); journal days are `YYMMDD` (`261003`), as the Emacs config's denote-journal makes them. People are headings in one Denote note, linked as `[[denote:ID::#name]]`. The vault was migrated from org-roam IDs the same day.
- **Features:** all kept. What shows is chosen per device with the shortcut bar buttons and settings.
- **Backlinks:** a *Show backlinks* setting turns the section at the end of notes on or off per vault and device (BL-6, 2026-10-24).
- **Getting it onto devices:** `npm run deploy` on the desktop; on the phone, copy `main.js`, `manifest.json` and `styles.css` by hand. No releases or tags are made from this branch.
