# Flavour: harshad

This branch (`harshad`) is the plugin author's own copy, kept on top of the base on `main`. Base work happens on `main` and is merged in here; what's below is committed only on this branch.

## How Org is used
- Org files shared with Emacs (org-roam) through Syncthing, edited in Obsidian on an Android phone and on the desktop.
- Tasks, a daily journal, notes linked by ID, and quick capture on the phone.

## Decisions
- **Keywords:** open `TODO NEXT DOING WAITING`, done `DONE CANCELLED` (2026-10-24). This trims the older list, which also had `PENDING`, `CANCELED`, `CANCEL`, `REJECTED`, `STOP` and `STOPPED`; headings that still use those read as plain titles.
- **Journal:** the base header, with a new `:ID:` (2026-10-24).
- **IDs:** a new `:ID:` is microseconds since the Unix epoch (`orgId: microsecondId`, 2026-10-27), as the Emacs config makes them. Org-roam links (`links: "id"`). Denote was tried on 2026-10-26 and dropped the next day as too unintuitive; the vault's notes and headings were given microsecond IDs dated as near their creation as could be found.
- **Attachment names:** recordings are `YYMM-voice-note-CC.<ext>` and pasted images `YYMM-pasted-image-CC.<ext>`, CC counting that month's anywhere in the vault (`mediaName: countedMediaName`, ATT-6, 2026-10-27), matching the vault's attachments, which were all renamed to `YYMM-slug` that day.
- **Features:** all kept. What shows is chosen per device with the shortcut bar buttons and settings.
- **Backlinks:** a *Show backlinks* setting turns the section at the end of notes on or off per vault and device (BL-6, 2026-10-24).
- **Getting it onto devices:** `npm run deploy` on the desktop; on the phone, copy `main.js`, `manifest.json` and `styles.css` by hand. No releases or tags are made from this branch.
