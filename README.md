# Org Flex

Edit [Org mode](https://orgmode.org) files in Obsidian, on the phone as comfortably as on the desktop. `.org` files open in a live-preview editor that reads like a note and still saves plain Org, so the same files keep working in Emacs.

**Org Flex is meant to be forked.** No two people use Org the same way: one lives in org-roam, another in denote, a third in one big outline with `org-attach` folders and a custom agenda. Rather than one plugin with a setting for every Org option, Org Flex is a base you fork and turn into *your own* plugin, with a coding agent doing the work.

<!-- Screenshots: add phone and desktop captures to docs/ and link them here. -->

## Your configuration is code, not settings

In most plugins, making it yours means a long settings page. In Org Flex, your choices live in the plugin's source:

- **Your keywords, templates and what is folded or hidden** are values in [`src/flavour.ts`](src/flavour.ts).
- **The features you use** are files in [`src/features/`](src/features/), listed in `src/features/index.ts`. A feature you don't use is deleted, not switched off. A feature you need and nobody else does (denote file names, `org-attach` folders, transclusion) is written for you.
- **How each thing behaves** is a numbered rule in [`SPEC.md`](SPEC.md), with tests. Your agent changes the rule, then the code and the tests, and the test suite tells it whether everything else still holds.
- **Who you are and why** is recorded in `FLAVOUR.md`, so the next agent session doesn't ask again.

The settings tab keeps only what differs between your own vaults and devices: the journal folder, the capture inbox, the shortcut bar. Everything about *how you work with Org* is code you own, in a plain git history you can read, diff and undo.

Four invariants hold in every fork, guarded by tests: files stay plain Org, the phone comes first, every rule is tested, and command ids never change.

## Get started: the tailoring interview

1. **Fork this repository.** You can also make a branch of your own in your copy, the way the author keeps theirs (see [`TAILOR.md`](TAILOR.md)). Then `npm install`.
2. **Have Org Flex interview you.** In Claude Code, run `/tailor`. With another coding agent, ask it to follow [`TAILOR.md`](TAILOR.md). The interview starts from what you already have:
   - **Your setup:** it asks for your Emacs configuration (`init.el`, `config.org`, Doom or Spacemacs) and a few typical files, and reads them first, so it doesn't ask what it can see.
   - **Your packages:** for each one you use (org-roam or denote, `org-attach`, `org-transclusion`, `org-capture` templates, `org-agenda`, org-journal, citar, org-modern...), it asks what it does for you, what it leaves in your files, and what you need from it in Obsidian and on which device.
   - **Open questions:** it follows up on whatever you mention, your own Elisp and habits included, and asks what annoys you today. If you don't use Emacs, it asks the same about Orgzly, beorg, or how you want to work.
3. **Approve the proposal.** The agent sorts what it heard:
   - what already works;
   - your flavour values;
   - rules to change;
   - new features to write;
   - what isn't possible, and the nearest alternative;
   - wishes for later.

   It shows you the plan, and builds only after you say yes. A first round can be small, and you can run `/tailor` again whenever your workflow changes.
4. **Deploy.** Put your vault in `.deploy.json` (`{"vault": "~/my-vault"}`) or `$OBSIDIAN_VAULT`, then run `npm run deploy`. Copy `main.js`, `manifest.json` and `styles.css` to other devices.

After the interview, keep asking your agent for changes the same way: "log `CLOSED:` when I finish a task", "drop the journal", "make capture file into a date tree". [`recipes/`](recipes/) has worked examples of these kinds of change: GTD keywords, org-roam dailies with date IDs, logging `CLOSED:`, capture into a date tree, and dropping a feature.

## What the base ships

This is the starting point every fork inherits, with plain `TODO | DONE` keywords and every feature on.


**Editing**
- **Live preview:** headings sized like Markdown headings, emphasis without its markers, links showing their description, styled quote and source blocks with syntax highlighting and a copy button. The line with the cursor shows its raw text.
- **Folding:** fold any heading, drawer or block; cycle *Fold all → Outline → Expand all*.
- **Zoom:** show one heading and its subtree, with breadcrumbs back out. Long-press a heading's arrow to zoom in.
- **Shortcut bar** above the phone keyboard: undo, redo, visibility, zoom, new heading, heading level, TODO state, schedule, deadline, checkbox, blocks, links, IDs and more. Choose the buttons, their order and their icons.
- **Reading mode** per tab: no keyboard, no accidental edits; checkboxes, TODO keywords and dates still work.
- **Vim mode** follows Obsidian's setting.

**Lists and tasks**
- **Checklists:** tap to tick, `[n/m]` and `[n%]` counters, parent boxes that follow their children, Enter continues the list.
- **Drag to reorder** list items by their grip, sideways to indent, children included.
- **TODO keywords**, with scheduled and deadline dates from a date picker.
- **Agenda:** a tab with overdue tasks and the coming week from your top-level org files, including repeating dates such as birthdays (`<… +1y>`).
- **Repeating tasks** move on when marked done, as in Emacs, and `CLOSED:` can be logged.
- **Task lists in Markdown notes:** an ` ```orgmode-tasks ` block lists an org file's tasks, filtered and sorted with Orgzly's search language, or as an agenda.

**Notes and links**
- **org-roam style links:** `[[` lists notes and headings by title and inserts `[[id:<uuid>][Title]]`; selected text becomes an ID link when a note has that title. A new title creates the note.
- **Denote, when your fork chooses it:** set `links: "denote"` in `src/flavour.ts` and notes, journal days and attachments get Denote names (`ID--title__keywords.ext`); `[[denote:ID]]` links open notes and `::#custom-id` headings, and show images and audio inline.
- **Go to node:** find any note or heading by title, or create it.
- **Backlinks:** linked and unlinked mentions at the end of every note, with a button to turn a mention into a link.
- **Front matter panel:** the property drawer and `#+` lines at the top show as a title and properties.
- **Images and audio inline:** `[[photo.jpg]]` shows the picture and `[[memo.m4a]]` a player. Paste images, attach any file or record a voice note from the bar; it is linked as a relative `[[file:…]]` link.
- **Links follow renames:** rename or move a file or folder and the file links to it in org notes are updated, relative to each note, as Obsidian does for Markdown.

**Capture and journal**
- **Capture:** one box from anywhere (command, ribbon, bar or an `obsidian://org-capture` link from other apps) files a TODO, with its state and scheduled date, into your inbox, linked back to the note you were in.
- **Journal:** today's file, a searchable list and a calendar, stored as `journal/YYYY/MM/YYYY-MM-DD.org`, started from the template in `src/flavour.ts`.
- **New org notes** named after their title, with an org-roam style UUID `:ID:`.

## Install the base as it is

To try Org Flex before tailoring it, install the base. It is in beta and not yet in the community plugin directory:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/harshadjs/org-flex/releases) into `<vault>/.obsidian/plugins/org-flex/`, or build them yourself (`npm install && npm run build`).
2. Turn on *Settings → Files and links → Detect all file extensions*, so `.org` files show in the file explorer.
3. Turn off any other plugin that opens `.org` files, such as *Orgmode (cm6)*: only one plugin can own the extension. Org Flex tells you if another one has it.
4. Enable **Org Flex** under *Community plugins*.

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
