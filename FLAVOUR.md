# Flavour: harshad

This branch (`harshad`) is the plugin author's own copy, kept on top of the base on `main`. Base work happens on `main` and is merged in here; what's below is committed only on this branch.

## How Org is used
- Org files shared with Emacs (org-roam) through Syncthing, edited in Obsidian on an Android phone and on the desktop.
- Tasks, a daily journal, notes linked by ID, and quick capture on the phone.

## Decisions
- **Keywords:** open `TODO IN-PROGRESS WAITING`, done `DONE CANCELLED`, the same as the Emacs config's `org-todo-keywords` (2026-10-29). Until then Org Flex had `TODO NEXT DOING WAITING`, which no heading used, while three used `IN-PROGRESS`. The 2026-10-24 list had already dropped `PENDING`, `CANCELED`, `CANCEL`, `REJECTED`, `STOP` and `STOPPED`; headings that still use those read as plain titles.
- **Done tasks are logged as in Emacs** (`org-log-done 'time`, `org-log-repeat 'time`): `CLOSED: [time]` (`logDone: true`, ACT-15), and repeating tasks move on, with `:LAST_REPEAT:` and a state line (ACT-14) (2026-10-29).
- **Agenda:** "Open agenda" (`org-agenda`, the `agenda` bar button) lists overdue tasks and the coming week from the top-level org files, as `org-agenda-files` does, with the `Birthday: <… +1y>` lines in `people.org` on their day (AG-1..3, 2026-10-29).
- **Src blocks** have a copy button, as tapping a `#+begin_src` line copies the block in the Emacs touch config (LP-14, 2026-10-29).
- **Journal:** the base header, with a new `:ID:` (2026-10-24).
- **IDs:** a new `:ID:` is a random UUID, with the moment it was made in `:CREATED:` (`[2026-11-22 Sun 14:05]`) on the next line (`orgId: uuidId`, IDX-4, 2026-11-22), as the Emacs config makes them: the user wanted the vault consistent with org-roam's defaults. Every `ts` ID in the vault became a UUID that day, its time kept as `:CREATED:` (map in the vault's `tools/uuid-migrate/id-map.tsv`). "Set created time" (ACT-16) now changes only `:CREATED:`, so no link moves. Before: from 2026-10-29 a new ID was the local time to the microsecond in org-id's `ts` style, `20261029T143012.123456`; from 2026-10-27 to 10-29 microseconds since the epoch as digits. Org-roam links (`links: "id"`). Denote was tried on 2026-10-26 and dropped the next day as too unintuitive.
- **Attachment names:** recordings are `YYMM-voice-note-CC.<ext>` and pasted images `YYMM-pasted-image-CC.<ext>`, CC counting that month's anywhere in the vault (`mediaName: countedMediaName`, ATT-6, 2026-10-27), matching the vault's attachments, which were all renamed to `YYMM-slug` that day. Emacs names them the same way since 2026-11-18: org-download saves dropped files as `YYMM-<slug>` and clipboard images (`C-c y`) as `YYMM-pasted-image-CC` in `attachments/`, linked as bare relative `[[file:…]]` (config.org, "Org Download").
- **Features:** all kept. What shows is chosen per device with the shortcut bar buttons and settings.
- **Backlinks:** a *Show backlinks* setting turns the section at the end of notes on or off per vault and device (BL-6, 2026-10-24).
- **Tables** (2026-10-30) show as a grid, edited cell by cell in place (TBL-1..7); the user chose that over Emacs-style text editing, for the phone. Column widths leave out emphasis markers (`hideEmphasisMarkers: true`, TBL-3), because the Emacs config sets `org-hide-emphasis-markers t` and `org-table-align` then measures what it shows, so a table aligned here stays aligned after `C-c C-c` there. Nothing was added on the Emacs side. Of the vault's 305 tables, 229 were never aligned (written by hand or by an AI) and get aligned the first time a cell changes.
- **Getting it onto devices:** `npm run deploy` on the desktop; on the phone, copy `main.js`, `manifest.json` and `styles.css` by hand. No releases or tags are made from this branch.

- **Attachments** (2026-11-23): org-attach, as the Emacs config: a node's files live in `attachments/<first 2 of its ID>/<rest>/` (`attachDir: "attachments"`, ATT-7), owned by the nearest heading or file above with an ID, linked `[[attachment:NAME]]`. The user chose `attachments/` (gitignored, synced, visible to Obsidian) over `.attach/` and `data/`, ownership by the nearest node with an ID over org's default of giving the heading an ID, and kept `YYMM-slug` names. The vault's 152 linked flat attachments were moved that day (map in the vault's `tools/attach-migrate/moves.tsv`).
- **Timeline** (2026-10-29): every file and heading ID newest first, by its `:CREATED:` (since 2026-11-22; else an old ID's time), journal days included, with attachments nested under the earliest node that links them (TL-1..4). Emacs has the same as `C-c n t`. Turn on the `timeline` bar button to use it from the phone.

- **Notes grid** (2026-11-10), on this branch only (the user: not a typical Org mode feature, so not on `main`): a Google Keep-like grid of every org file is the start page (the `startView` setting, PLAT-10, defaults to `grid` on this branch; it was the flavour's `gridStartPage` until 2026-11-12), replacing the Bases-style view first discussed (collection fields such as status and rating dropped for now). Cards show the title and up to 12 lines; pinned first, then by last change. Pin and colour are `#+pinned` / `#+color` lines and labels are `#+filetags`, all of them (the user chose to see the noisy `recovered` and `unlinked` tags rather than hide them). `journal/`, `topics/` and `ai/` are hidden until their chip is chosen (`gridHiddenFolders: ["topics", "ai"]`, GRID-8), by folder because 119 of the 121 topic hubs have no tag. Nothing on the Emacs side.

## Wishes
Raised in the 2026-10-29 interview and not built yet:
- `org-crypt` (`:crypt:` subtrees) and `org-transclusion` are set up in Emacs but used nowhere in the vault. If they are used later: show encrypted entries folded and read-only, and transclusions inline and read-only.
- Capturing a person, topic or place, like the `p`/`T`/`l` capture templates (a heading in `people.org`, or `topics/<title>.org` and `places/<title>.org`).
- Archiving a subtree to `archive.org`, like `org-archive-location`.
