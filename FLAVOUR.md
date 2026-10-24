# Flavour: harshad

This branch (`harshad`) is the plugin author's own copy, kept on top of the base on `main`. Base work happens on `main` and is merged in here; what's below is committed only on this branch.

## How Org is used
- Org files shared with Emacs (org-roam) through Syncthing, edited in Obsidian on an Android phone and on the desktop.
- Tasks, a daily journal, notes linked by ID, and quick capture on the phone.

## Decisions
- **Keywords:** open `TODO NEXT DOING WAITING`, done `DONE CANCELLED` (2026-10-24). This trims the older list, which also had `PENDING`, `CANCELED`, `CANCEL`, `REJECTED`, `STOP` and `STOPPED`; headings that still use those read as plain titles.
- **Journal:** the base header, with a new UUID as `:ID:` (2026-10-24). Days made earlier keep `:ID: YYYY-MM-DD`.
- **Features:** all kept. What shows is chosen per device with the shortcut bar buttons and settings.
- **Getting it onto devices:** `npm run deploy` on the desktop; on the phone, copy `main.js`, `manifest.json` and `styles.css` by hand. No releases or tags are made from this branch.
