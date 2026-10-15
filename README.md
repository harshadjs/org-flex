# Org Flex

Edit [Org mode](https://orgmode.org) files in Obsidian, on the desktop and on the phone.

- **Live preview:** headings sized like Markdown headings, markup without its markers, links that show their description, inline images, styled blocks with syntax-highlighted source code.
- **Folding:** fold any heading, drawer or block; cycle *Fold all → Outline → Expand all*.
- **Checklists:** tappable checkboxes, `[n/m]` and `[n%]` counters, parent boxes that follow their children, Enter continues a list.
- **Shortcut bar:** undo, redo, visibility, heading level, TODO state, schedule, deadline, checkbox, link, journal and new note buttons, with your own icons.
- **Front matter panel:** the property drawer and `#+` lines at the top show as a title and a list of properties.
- **Links:** `[[file]]`, `[[id:ID]]` (found through a vault-wide index), URLs.
- **Backlinks:** linked and unlinked mentions at the end of every note, with a button to turn a mention into a link.
- **Drag to reorder** a heading together with its subtree.
- **Journal:** today's note, a searchable list and a calendar, stored as `journal/YYYY/MM/YYYY-MM-DD.org`, compatible with org-roam.
- **New org notes** named after their title, with an org-roam style UUID `:ID:`.
- **org-roam style links:** `[[` lists notes and headings by title and inserts `[[id:<uuid>][Title]]`.
- **Task lists in Markdown:** an ` ```orgmode-tasks ` block lists the tasks of an org file, filtered and sorted with Orgzly's search language, or as an agenda.

`SPEC.md` describes every behaviour in detail.

## Install

Build it (`npm install && npm run build`) and copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/org-flex/`. Then:

1. Turn on *Settings → Files and links → Detect all file extensions*, so `.org` files show in the file explorer.
2. Disable any other plugin that opens `.org` files (such as *Orgmode (cm6)*): only one plugin can own the extension.
3. Enable *Org Flex* under *Community plugins*.

## Task blocks

````markdown
```orgmode-tasks
filepath: tasks.org
query: it.todo s.le.today o.p
```
````

Queries: `it.todo`, `it.done`, `it.none`, `i.KEYWORD`; `s.`/`d.`/`c.` with `eq ne lt le gt ge` and `today`, `tomorrow`, `yesterday`, `now`, `3d`, `2w`, `1m`, `1y` or `none`; a leading `.` negates; `o.s o.d o.c o.p o.st` sort (`.o.` descending); `ad.7` shows a 7-day agenda; combine with `and`, `or` and parentheses.

## Development

```bash
npm test        # vitest
npm run build   # type-check and bundle
npm run dev     # rebuild on change
```
