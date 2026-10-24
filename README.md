# Org Flex

Edit [Org mode](https://orgmode.org) files in Obsidian, on the phone as comfortably as on the desktop. `.org` files open in a live-preview editor that reads like a note and still saves plain Org, so the same files keep working in Emacs.

<!-- Screenshots: add phone and desktop captures to docs/ and link them here. -->

## Features

**Editing**
- **Live preview:** headings sized like Markdown headings, emphasis without its markers, links showing their description, styled quote and source blocks with syntax highlighting. The line with the cursor shows its raw text.
- **Folding:** fold any heading, drawer or block; cycle *Fold all → Outline → Expand all*.
- **Zoom:** show one heading and its subtree, with breadcrumbs back out. Long-press a heading's arrow to zoom in.
- **Shortcut bar** above the phone keyboard: undo, redo, visibility, zoom, new heading, heading level, TODO state, schedule, deadline, checkbox, blocks, links, IDs and more. Choose the buttons and their icons.
- **Reading mode** per tab: no keyboard, no accidental edits; checkboxes, TODO keywords and dates still work.
- **Vim mode** follows Obsidian's setting.

**Lists and tasks**
- **Checklists:** tap to tick, `[n/m]` and `[n%]` counters, parent boxes that follow their children, Enter continues the list.
- **Drag to reorder** list items by their grip, sideways to indent, children included.
- **TODO keywords** of your own, with scheduled and deadline dates from a date picker.
- **Task lists in Markdown notes:** an ` ```orgmode-tasks ` block lists an org file's tasks, filtered and sorted with Orgzly's search language, or as an agenda.

**Notes and links**
- **org-roam style links:** `[[` lists notes and headings by title and inserts `[[id:<uuid>][Title]]`; selected text becomes an ID link when a note has that title. A new title creates the note.
- **Go to node:** find any note or heading by title, or create it.
- **Backlinks:** linked and unlinked mentions at the end of every note, with a button to turn a mention into a link.
- **Front matter panel:** the property drawer and `#+` lines at the top show as a title and properties.
- **Images and audio inline:** `[[photo.jpg]]` shows the picture and `[[memo.m4a]]` a player. Attach photos or files, or record a voice note, from the bar.

**Capture and journal**
- **Capture:** one box from anywhere (command, ribbon, bar or an `obsidian://org-capture` link from other apps) files a TODO, with its state and scheduled date, into your inbox, linked back to the note you were in.
- **Journal:** today's file, a searchable list and a calendar, stored as `journal/YYYY/MM/YYYY-MM-DD.org`, started from a template you set.
- **New org notes** named after their title, with an org-roam style UUID `:ID:`.

## Make it yours

Org is used in very different ways, so Org Flex doesn't try to offer every option as a setting. It is a base you fork and shape to your own workflow with a coding agent. Every behaviour is a numbered rule in [`SPEC.md`](SPEC.md) with tests, so an agent can change it safely, and four invariants keep every fork sound: files stay plain Org, the phone comes first, every rule is tested, and command ids never change.

1. Fork this repository.
2. Ask your coding agent to tailor it. In Claude Code, run `/tailor`; other agents, point them at [`TAILOR.md`](TAILOR.md). It interviews you about how you use Org: tasks, notes, journal, capture, and Emacs or not. Then it keeps, changes or drops features, sets your keywords and templates in `src/flavour.ts`, and records your choices in `FLAVOUR.md`.
3. Install your fork's own releases with BRAT, or `npm run deploy` to your vault.

[`recipes/`](recipes/) has worked examples: GTD keywords, org-roam dailies with date IDs, logging `CLOSED:`, capture into a date tree, and dropping a feature.

## Install

Org Flex is in beta. Until it is in the community plugin directory, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from *Settings → Community plugins*.
2. In BRAT, choose *Add beta plugin* and enter `harshadjs/org-flex`.
3. Turn on *Settings → Files and links → Detect all file extensions*, so `.org` files show in the file explorer.
4. Turn off any other plugin that opens `.org` files, such as *Orgmode (cm6)*: only one plugin can own the extension. Org Flex tells you if another one has it.
5. Enable **Org Flex** under *Community plugins*.

Or download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/harshadjs/org-flex/releases) into `<vault>/.obsidian/plugins/org-flex/`.

## Capturing from other apps

`obsidian://org-capture?title=…&text=…&url=…` (each part optional and URL-encoded) opens the capture box filled in. Use it from a phone shortcut, a share-sheet app or a browser bookmarklet, for example:

```js
javascript:location.href='obsidian://org-capture?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)
```

## Task blocks

````markdown
```orgmode-tasks
filepath: tasks.org
query: it.todo s.le.today o.p
```
````

Queries: `it.todo`, `it.done`, `it.none`, `i.KEYWORD`; `s.`/`d.`/`c.` with `eq ne lt le gt ge` and `today`, `tomorrow`, `yesterday`, `now`, `3d`, `2w`, `1m`, `1y` or `none`; a leading `.` negates; `o.s o.d o.c o.p o.st` sort (`.o.` descending); `ad.7` shows a 7-day agenda; combine with `and`, `or` and parentheses.

## Working with Emacs

Files are saved as plain Org, and a change made on disk (by Emacs, or a sync tool) is merged into an open editor without losing the cursor or folds. IDs, `[[id:…]]` links, the journal layout and new notes follow org-roam's conventions, and attachments are linked relative to the note (`[[file:../attachments/a.jpg]]`), as Org resolves them.

## Not supported yet

- Promote and demote change one heading line, not its subtree; headings can't be moved up or down.
- Marking a task done doesn't add `CLOSED:`; there are no repeaters or an agenda view beyond task blocks.
- Tab indents only the selected lines (dragging a list item sideways handles children and counters).
- No tables editor, export, babel execution or clocking.

## Behaviour and development

[`SPEC.md`](SPEC.md) describes every behaviour as a numbered rule, each tied to a test or a manual check.

```bash
npm install
npm test             # vitest
npm run build        # type-check and bundle
npm run dev          # rebuild on change
npm run deploy       # build and copy into the vault in .deploy.json or $OBSIDIAN_VAULT
```

Releases: `npm version patch`, then `git push --follow-tags`; GitHub Actions builds a draft release.

## License

[MIT](LICENSE)
