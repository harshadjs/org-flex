# Org Flex — Behaviour Spec

This file says what the plugin is supposed to do, so that a future change can be
checked against it. If a change breaks a rule here, either the change is wrong or
this file must be updated in the same commit, on purpose.

- Each rule has an ID (`VIEW-2`, `CHK-5`, ...) so it can be referred to in commits
  and reviews.
- **Every rule must be testable.** Each one carries **Test:**, naming the
  automated tests that check it (`npm test`), or **Manual:**, saying why only a
  person in Obsidian can check it, or both when a test covers part of it. A
  Manual rule appears in the [manual checklist](#16-manual-checklist) at the end.
  `test/spec.spec.ts` fails if a rule has neither, cites a test that doesn't
  exist, or is Manual without a checklist entry.
- "Known gaps" list things the plugin does *not* do yet. They're written down so
  nobody mistakes them for bugs, or "fixes" them without meaning to.

Code locations are given as files. Line numbers change too often to be useful.
The code is split into `src/org/` (pure Org logic, no editor or Obsidian),
`src/editor/` (CodeMirror extensions), `src/ui/` (Obsidian dialogs, settings tab,
task blocks), `src/view.ts` and `src/main.ts`.

---

## 1. Plugin and platform

| ID | Rule |
|---|---|
| PLAT-1 | Plugin id `org-flex` (`manifest.json`). The id is the plugin's folder name in `.obsidian/plugins/` and must never change, or every user's install and settings are lost. **Test:** "the plugin id is org-flex, and it names the view type". |
| PLAT-2 | Works on desktop and mobile (`isDesktopOnly: false`). `minAppVersion` is `1.4.0`, so no Obsidian API newer than 1.4.0 may be used without raising it. Example: use `vault.getAbstractFileByPath(...)` + `instanceof TFile`, not `getFileByPath` (1.5.7). **Test:** "the manifest targets desktop and mobile, and no API newer than 1.4.0 is used". |
| PLAT-3 | `.org` files open in the plugin's own view (view type `org-flex`). Obsidian only lists them in the file explorer when *Files and links → Detect all file extensions* is on. Only one plugin can own the `.org` extension, so Org Flex can't be enabled together with another org plugin (such as `orgmode-cm6`). **Manual:** needs Obsidian to register the view and the extension. |
| PLAT-4 | The editor is the plugin's own CodeMirror 6 instance, separate from Obsidian's Markdown editor, and CodeMirror is **bundled** into `main.js` rather than borrowed from Obsidian, so it never depends on the versions Obsidian ships. Markdown editor features do not apply to org files unless the plugin builds them. **Test:** "CodeMirror is bundled: only obsidian and electron stay external". |
| PLAT-5 | Build: `npm run build` type-checks (`tsc --noEmit`) and then bundles with esbuild (`esbuild.config.mjs`). The only files deployed to a vault are `main.js`, `manifest.json` and `styles.css`. `.npmrc` sets `legacy-peer-deps`, because the `obsidian` typings pin CodeMirror versions the plugin doesn't use. **Test:** "the build type-checks then bundles, and deploys exactly the three artifacts". |

## 2. The org file view

`src/view.ts` (`OrgFlexView`)

| ID | Rule |
|---|---|
| VIEW-1 | Opening a file loads its text into a new editor state. The tab title is the file name without extension. **Manual:** needs Obsidian's file loading and tabs. |
| VIEW-2 | Every document change asks Obsidian to save (`requestSave`). Obsidian decides when to write. **Manual:** needs Obsidian's saving. |
| VIEW-3 | Closing the view saves first and destroys the editor afterwards (`super.onClose()` then `destroy()`), because saving reads the editor's text. **Manual:** needs Obsidian's view lifecycle. |
| VIEW-4 | Undo/redo history is CodeMirror's `history()`. Keymap: CodeMirror defaults, history and search keys, and Tab indents. List continuation (CHK-8) has priority over the default Enter. **Test:** "the keymap: Tab indents, Enter continues lists, undo takes edits back". **Manual:** Vim's priority needs Obsidian's Vim setting. |
| VIEW-5 | Vim mode follows Obsidian's *Vim key bindings* setting. It's checked when the editor gains or loses focus, so changing the setting takes effect on the next focus change. Vim has the highest key priority, so in normal mode Enter is Vim's; in insert mode it reaches CHK-8. **Manual:** needs Obsidian's Vim setting. |
| VIEW-6 | Lines wrap. `scrollPastEnd()` is on, so short or fully folded documents can still scroll (mobile requirement, see §13). The caret and selection are the browser's own (no drawn selection), which keeps native selection handles on phones. **Test:** "lines wrap and the selection is the browser's own". **Manual:** scrolling a fully folded file needs a real layout. |
| VIEW-7 | Saving settings applies them to every open org view without reopening it: TODO keywords, hidden stars, the shortcut bar, the front matter panel, backlinks and drag handles. **Manual:** needs open Obsidian views and the settings tab. |
| VIEW-8 | Spellcheck follows Obsidian's *Editor → Spellcheck* setting (on unless it is turned off). The editor sets `spellcheck="true"` (plus `autocorrect` and `autocapitalize` for mobile keyboards) on its content. The setting is read when the file is opened, so a change applies to files opened afterwards. **Test:** "lines wrap and the selection is the browser's own". **Manual:** the underline needs Obsidian's setting. |
| VIEW-9 | **Changes on disk** (Syncthing, Emacs) are applied to the open editor as one edit covering only the part that differs, so the cursor, folds and undo history survive. Undo can take the external change back, like any edit. Opening a different file in the view builds a fresh state. **Test:** "externalChange replaces only the part that differs". **Manual:** needs Syncthing or Emacs writing the file. |

## 3. Parsing and syntax highlighting

`src/org/syntax.ts`. The parser is hand-written and line based: `analyze` classifies every line, `parseInline` parses links and markup on one line. It runs synchronously, so the whole structure is always available. The editor keeps the analysis in the `docInfo` state field (`src/editor/state.ts`), recomputed on every document change. Tests: `test/syntax.spec.ts`.

| ID | Rule |
|---|---|
| PARSE-1 | Supported: headings (any depth) with TODO keyword, priority, title and tags; planning lines (only directly after a heading); drawers, with `:KEY: value` lines in property drawers; blocks (`#+begin_X` … `#+end_X`, any name, with the source language); keyword lines (`#+KEY:`), comment lines (`# `); text markup (bold, italic, underline, verbatim, code, strike-through) including nesting; regular `[[…]]`, angle `<scheme:…>` and plain URL links; markup and links combined. A block or drawer only counts if it is closed before the next heading (headings always win, as in Org); otherwise its first line is plain text. **Test:** "planning only directly after a heading, drawers and blocks need their end line", "headings are stars at column 0 followed by whitespace or the end", "heading keyword, priority, title and tags", "text markup, nested", "links: regular, with description, angle and plain", "markup and links combined; markup never ends inside a link". |
| PARSE-2 | Overlapping markup is resolved into a tree: an opening marker pairs with the nearest valid closing one, so in `*one _two three* four_`, `*one _two three*` is bold and ` four_` is plain. This deliberately differs from Emacs. Markers need Org's borders (whitespace or `-({'"` before, whitespace or punctuation after); the edges of the enclosing markup also count, so `*bold /italic/*` nests. Verbatim and code contents are not parsed. Markup is matched within one line. **Test:** "markup criss-cross becomes a tree, unlike Emacs", "markers need a valid border", "verbatim and code contents are not parsed". |
| PARSE-3 | TODO and DONE keywords come from the settings (`todoKeywords`, `doneKeywords`). A keyword is only recognised as the first word of a heading title, exactly as configured. **Test:** "a keyword is only recognised at the start of the title, as configured". |
| PARSE-4 | Source blocks get syntax highlighting for c, c++/cpp, css, html, java, javascript/js, typescript/ts, json, php, python/py, rust, sass, scss and xml (`src/editor/src-highlight.ts`). Each visible block is parsed with that language's Lezer parser; token classes `org-tok-*` map onto Obsidian's `--code-*` colours. **Test:** "the editor renders every feature without errors". |
| PARSE-5 | The parser must never hang on any input. **Test:** "the parser never hangs". |

Not parsed: lists as tree nodes (handled line by line instead, §8), horizontal rules, timestamps as nodes, clocks, footnotes, tables, LaTeX, fixed-width lines, dynamic blocks, markup spanning lines.

## 4. Live preview

`src/editor/preview.ts`. Line decorations are computed for the visible lines on every transaction; hiding a block's last line crosses a line break, so that comes from a state field over the whole document.

| ID | Rule |
|---|---|
| LP-1 | **Markup:** the opening and closing markers (`*…*`, `/…/`, `_…_`, `=…=`, `~…~`, `+…+`) are hidden unless the cursor or selection touches the node. The node gets an `org-text-*` class (`bold`, `italic`, `underline`, `verbatim`, `code`, `strikethrough`); shown markers get `org-markup-marker`. **Test:** "markup markers hide away from the cursor and show as markers when it touches". |
| LP-2 | **Links:** `[[target][desc]]` shows only `desc` and `[[target]]` shows only `target`, unless the cursor touches the link. This holds when `desc` equals `target` too (`[[pkm][pkm]]` shows `pkm`). Rendered links get the class `org-link`; while the cursor touches one it shows raw with `org-link-source`. Angle and plain links are never hidden. **Test:** "tapping a rendered link opens it; a raw link or a swipe doesn't". |
| LP-3 | **Images:** a `[[target]]` link without description whose target ends in `.apng .avif .gif .jpeg .jpg .png .svg .webp` is shown as the image, resolved through the vault, or used as a URL if the vault can't resolve it. **Test:** "link classification and images" (the extension check). |
| LP-4 | **Blocks:** every line of a block gets the line class `org-block` (plus `org-block-<name>`, `org-block-begin`, `org-block-end`). The `#+BEGIN_` prefix of the first line is hidden unless the cursor is on that line, and the rest of it gets `org-block-header`. The whole last line, with its line break, is hidden unless the cursor is on it. **Test:** "blocks get block line classes and hide their markers away from the cursor". |
| LP-5 | **Headings:** the heading line gets the line classes `HyperMD-header HyperMD-header-N cm-org-level-N`, and the text after the stars gets `org-heading org-heading-N cm-header cm-header-N`. N is capped at 6, so deeper headings look like level 6. **Test:** "headings get level classes, capped at 6, and stars hide when asked". |
| LP-6 | **Heading size** is set on the *line* only (`.cm-line.cm-org-level-N`). The heading text inherits it. Setting it on both makes the `em` sizes multiply. Sizes and colours use Obsidian's `--hN-*` variables, so themes apply. **Test:** "heading sizes are set on the line only, from the theme's heading variables". |
| LP-7 | **Hide stars** (`hideStars`): the leading stars and their space are hidden unless the cursor touches them. All the stars are hidden even when there are more than 6. Shown stars get `org-heading-stars`. **Test:** "headings get level classes, capped at 6, and stars hide when asked". |
| LP-8 | Planning lines, property drawers, other drawers, comments, keyword lines, TODO keywords, priorities and tags get `org-planning`, `org-propertydrawer`, `org-drawer`, `org-comment`, `org-meta-line`, `org-keyword` (plus `org-keyword-todo` or `org-keyword-done`, and `data-keyword`), `org-priority` and `org-tags`. These class names are public: user CSS snippets depend on them. **Test:** "planning, drawers, comments, keyword lines, keywords, priorities and tags get their classes". |
| LP-9 | **Completion** (`src/editor/completion.ts`), org-roam style: typing `[[` offers every org ID in the vault **by title**, never by ID (from the index, IDX-1). A note's file-level ID shows as the note's title, with its folder beside it. A heading's ID shows as the heading's title (no keyword, priority or tags; links as their text), with the note's title beside it. Picking one inserts `[[id:<id>][<title>]]`, so it reads as the title in live preview; brackets are dropped from the description. After those come the vault files with no file-level ID (`.org` and `.md` by name without extension, others with it), which insert `[[<file>]]`. Typing `[[id:` still offers every raw `:ID:`, with the file it's in. Choosing an entry adds the closing `]]` unless it's already there, and leaves the cursor after the link. **Test:** "titleCompletions lists notes and headings by title, never by ID", "picking a title after [[ inserts an ID link with the title as description". |

## 5. Links

`src/editor/preview.ts` (taps and clicks), `src/org/syntax.ts` (`classifyLink`), `src/main.ts` (`openLink`, `findId`).

| ID | Rule |
|---|---|
| LINK-1 | Tapping or clicking a rendered link (or a bare URL the cursor is not in) opens it, without placing the cursor or bringing up the keyboard (the tap is handled on `touchend`/`mousedown` with the default prevented; a touch that moved is a scroll, not a tap). Links with a URL scheme (`https:`, `file:`, ...) are external and open with `window.open`. `id:` links jump to an org ID. Anything else is a file in the vault. A link shown raw (cursor inside) is edited, not opened. **Test:** "tapping a rendered link opens it; a raw link or a swipe doesn't", "link classification and images". **Manual:** opening the target needs Obsidian. |
| LINK-2 | File links are resolved with Obsidian's link resolution: first the target as written, then the target plus `.org`. In practice `[[unicorn]]` opens `unicorn.md` when it exists and `unicorn.org` otherwise. A `::search` part is ignored. **Manual:** uses Obsidian's link resolution. |
| LINK-3 | `[[id:X]]` opens the org file containing a property drawer with `:ID: X`, puts the cursor at that entry (opening any fold around it) and scrolls it to the top. File-level drawers count. The file is found through the index (IDX-1), waiting up to 2 s for it to be built; only an ID the index doesn't know falls back to reading every `.org` file. **Test:** "VaultIndex finds IDs and follows file changes". **Manual:** opening the file and waiting for the index need Obsidian. |
| LINK-4 | Plain `[[X]]` is never treated as an ID link by the plugin; it is a file link (LINK-2). The Emacs config (org-roam) does treat it as `[[id:X]]`, for indexing and for following. The two agree for older notes, whose file is named after their ID (`X.org` has `:ID: X`). New notes get a UUID (NOTE-3), and the plugin links to notes with `[[id:<uuid>][<title>]]` (LP-9, BL-3), which both resolve the same way, so `[[X]]` is now only for files without an ID. **Test:** "link classification and images". |
| LINK-5 | An ID is the rest of its `:ID:` line, trimmed, so it may contain spaces (`:ID: My Note` is `My Note`), as in Org. An empty `:ID:` is no ID. **Test:** "readNote reads IDs, title and links". |

## 5a. Index and backlinks

`src/org/vault-index.ts` (index and pure functions), `src/editor/backlinks.ts` (the section), `src/main.ts` (vault events), `src/view.ts` (`refreshBacklinks`, `linkMention`). Tests in `test/index.spec.ts`. Setting `backlinks` (default on).

| ID | Rule |
|---|---|
| IDX-1 | **Index:** the plugin keeps, for every `.org` file, its IDs (with the offset of their entry: 0 for a drawer before the first heading, else the heading's start), its title (`#+title` before the first heading, else the file name), its note links and its text. It is built once the workspace layout is ready and updated on vault create, modify, delete and rename. Each heading ID also keeps the heading's title. ID lookups (LINK-3) and link completion by title (LP-9) use it. If two files have the same ID, the first one found wins. **Test:** "readNote reads IDs, title and links", "VaultIndex finds IDs and follows file changes". |
| IDX-2 | **Note links** are `[[target]]` and `[[target][desc]]` whose target has no URL scheme, or the `id:` scheme. `id:` and a final `.org` are removed, and so is a `::search` part. `*heading` and `#custom-id` targets are links inside a file, not note links. **Test:** "noteLinkTarget keeps note links and drops URLs, files and in-file targets". |
| BL-1 | **Linked mentions:** at the end of every org note, below the text, a section lists the other files with a note link to this one. A link counts if its target is the file name or any `:ID:` in the file, so links to a heading's ID count too. One entry per file, sorted by title, with each linking line. Links from the note to itself don't count. **Test:** "backlinksTo matches links by file name and by any ID in the file". |
| BL-2 | **Unlinked mentions:** a second section lists places in other files that name this note without linking to it. Names are the title and the file name, each also with `-` read as a space (`Chris-Evans` matches "Chris Evans"), at least 3 characters long. Matches are whole words (a letter, digit, `_` or `-` next to it means it's part of another word), ignore case, and skip text inside any `[[…]]` link and `#+` and `:PROPERTY:` lines. At most 50 are shown. This section starts closed and is only computed while open, because it searches every file. **Test:** "unlinkedMentionsOf finds whole-word mentions outside links". |
| BL-3 | **Link button:** each unlinked mention has a **Link** button that edits the other file (with `vault.process`), replacing the mention with `[[id:<file-level ID>][<mentioned words>]]`. A note without a file-level ID is linked by file name, with the words as the description when they differ (`[[Chris-Evans][Chris Evans]]`). If the file changed since it was indexed, nothing is edited and a notice says so. **Test:** "mentionLink links by ID with the mentioned words, or by file name without an ID". |
| BL-4 | Tapping a line opens that file in the current tab with the cursor on that line (a file title opens it at its first linking line), unfolding it if it's folded, without bringing up the mobile keyboard. Tapping a section header opens or closes it, without focusing the editor (MOB-7). Each view remembers which sections are open while it stays open. **Test:** "tapping a backlink opens it, and a section header toggles it, without focusing". **Manual:** opening the file needs Obsidian. |
| BL-5 | The section is a block widget at the end of the document, never part of the text. It refreshes when the index changes (batched, 300 ms after the last file event), when a file is opened in the view, and when settings change. **Test:** "VaultIndex finds IDs and follows file changes" (batching). |

## 6. Folding and visibility

`src/org/folding.ts` (pure), `src/editor/folding.ts`. Tests in `test/notes.spec.ts` and `test/editor.spec.ts`.

| ID | Rule |
|---|---|
| FOLD-1 | A heading can be folded when it has a section or sub-headings. The fold covers everything under it up to the next heading at the same or a higher level, excluding the final newline and any blank lines at the end, so a heading followed only by blank lines doesn't fold. **Test:** "a heading alone doesn't fold", "heading and section fold, without the final newline", "nested headings fold up to a heading of the same or higher level", "the zeroth section doesn't fold". |
| FOLD-2 | Drawers and blocks fold from their first line to the end of their last line. **Test:** "property drawers and blocks fold from their first line". |
| FOLD-3 | Fold markers are SVG arrow icons in the gutter, one for folded and one for unfolded. The gutter has no background or border. Folded text shows as `…`. **Test:** "fold markers are SVG arrows and folded text shows as …", "the gutters have no background or border". |
| FOLD-4 | There are three visibility levels. **Fold all:** only top-level headings show. **Outline:** every heading shows, but no section text. **Expand all:** everything shows. With *Fold properties drawer by default* on, property drawers are folded at every level, including Expand all, and also inside folded headings, so they stay folded when those open. Applying a level first opens every fold. **Test:** "visibility cycling: fold all, outline, expand all". |
| FOLD-5 | Opening a file applies *Default fold level* (`defaultFoldLevel`, default Fold all) straight away. Parsing is synchronous, so there is no waiting and no visible jump. **Test:** "default fold level 'foldall' folds top-level headings; drawers stay folded". |
| FOLD-6 | Cycling goes Fold all → Outline → Expand all → Fold all, from the shortcut bar button or the command `cycle-orgmode-visibility`. Each change shows a notice naming the new level. A freshly opened file counts as being at its default level. **Test:** "nextVisibility goes fold all, outline, expand all and back", "the visibility button's icon and label follow the level". **Manual:** the notice needs Obsidian. |
| FOLD-7 | While the front matter panel is on (§7), the top-of-file property drawer cannot be folded. It isn't folded on open, the gutter shows no marker for it and visibility changes leave it alone. Drawers under headings still fold. **Test:** "the front matter drawer is not foldable while the panel is on". |

## 6a. Reordering headings

`src/editor/heading-drag.ts`. Tests in `test/heading-drag.spec.ts`. Setting `headingDragHandles` (default on).

| ID | Rule |
|---|---|
| DRAG-1 | Every heading line has a grip (`grip-vertical`, class `org-drag-grip`) in a gutter of its own, right of the fold gutter. It is faint until hovered or dragged. On touch it starts a drag at once (no long press), because the grip has `touch-action: none` and doesn't pan or select text. **Test:** "every heading has a drag grip in its own gutter, right of the fold gutter", "the drag grip is faint until used and doesn't pan or select". **Manual:** dragging by touch needs a phone. |
| DRAG-2 | **What moves:** the heading with its subtree, up to the next heading of the same or a higher level (or the end). It keeps its level, as with Org's `M-up`/`M-down`, even when dropped under another parent. **Test:** "subtreeRange takes the heading and everything below it up to a heading of the same or higher level", "moveSubtree moves a heading with its subtree up and down, keeping its level". |
| DRAG-3 | **Where it can go:** before any visible heading outside the dragged subtree, or at the end of the document. Headings hidden in a fold are not targets. A line shows the drop place while dragging; dropping onto its own place does nothing. Within 48 px of the top or bottom edge the editor scrolls. **Test:** "dropGaps lists visible heading starts outside the dragged subtree and the end", "moveSubtree handles a document without a final newline and refuses no-op drops". |
| DRAG-4 | The move is one transaction (one undo). Folds inside the moved subtree stay folded, and the cursor goes to the moved heading. A document without a final newline keeps having none. **Test:** "moveSubtree is one undoable change and carries folds along". |

## 7. Front matter panel

`src/org/front-matter.ts` (pure), `src/editor/front-matter-panel.ts`. Tests in `test/notes.spec.ts` and `test/editor.spec.ts`. Setting `frontMatterPanel` (default on).

| ID | Rule |
|---|---|
| FM-1 | **What counts as front matter:** an optional `:PROPERTIES:` drawer that starts on line 1, then consecutive `#+KEY: value` lines. It ends at the first other line. An unterminated drawer (no `:END:` before a heading or the end) means there's no front matter. Keywords that belong to the next element (`#+name`, `#+caption`, `#+results`, `#+header`, `#+plot`, `#+tblfm`, `#+attr_*`) and `#+begin_` end it. **Test:** "parseFrontMatter reads the drawer and keyword lines", "parseFrontMatter: keywords only, none, unterminated drawers and affiliated keywords". |
| FM-2 | The front matter is replaced by a panel (a block widget; the range is atomic for the cursor). `#+title` is shown as a large title, styled with Obsidian's inline-title variables, as written. The other entries go under a "Properties" header, one row each: icon, key, value. **Test:** "the front matter panel shows the title and a row per property, and the cursor can't enter it". |
| FM-3 | **Values:** tags (`filetags`/`tags`, `:a:b:`) show as pills. Keys ending in `aliases` show as pills, with `"quoted phrases"` kept together. `ID`/`CUSTOM_ID` get a fingerprint icon, tags a tags icon, dates a calendar icon, links a link icon. Links show their description (or target) and dates lose their brackets. Empty values show "Empty". **Test:** "values: tags and aliases become pills, links and dates are simplified". |
| FM-4 | The Properties header collapses and expands without moving the cursor or focusing the editor. A collapsed header shows how many properties there are. The starting state follows `foldPropertyDrawers`. The title always shows. Changing other settings keeps the current collapsed state. **Test:** "the editor renders every feature without errors" (the count). |
| FM-5 | **Editing:** clicking the title or a row shows the raw text, with the cursor at the end of that line and the editor focused. So does moving the cursor into the front matter with the keyboard, or typing, deleting, undoing or redoing there. The panel comes back when the cursor leaves. Opening a file does *not* show the raw text, even though the cursor starts at position 0, and neither does any transaction that isn't the user's (folds, backlinks). **Test:** "the source shows only when the user moves into the front matter". |
| FM-6 | The panel is never stored in the document. Turning the setting off shows the raw text again, and the drawer becomes foldable again. **Test:** "the panel is never part of the document, and turning it off shows the raw text". |

## 8. Checklists

`src/org/lists.ts` (pure), `src/org/edit.ts` (commands), `src/editor/checklists.ts`. Tests in `test/edit.spec.ts`.

| ID | Rule |
|---|---|
| CHK-1 | **List items** are lines starting with optional indentation, a bullet (`-`, `+`, `1.`, `1)`, or `*` only when indented, since `*` at column 0 is a heading) and then whitespace or the end of the line. A checkbox is `[ ]`, `[x]`, `[X]` or `[-]` after the bullet and whitespace, followed by whitespace or the end of the line. `X` counts as `x`. **Test:** "parseItem recognises bullets and boxes". |
| CHK-2 | Lines inside `#+begin_…` blocks (and drawers, planning lines) are never list items: no widget, no toggling, no Enter handling. **Test:** "checkbox-like lines inside blocks are not list items". |
| CHK-3 | **Nesting:** an item belongs to the nearest item above it with less indentation. Text at or left of an item's indentation ends that item; blank lines don't. A section (heading to next heading) is the outer limit. **Test:** "text at or left of an item's indentation ends it". |
| CHK-4 | **Display:** checkboxes render as Obsidian task checkboxes (`task-list-item-checkbox`, `data-task`), with `[-]` drawn half-checked. The raw `[ ]` shows while the cursor is strictly inside the brackets. Text after a checked box gets `org-checkbox-done` (strike-through and muted, from Obsidian's checklist variables). Only visible lines are processed. **Test:** "checkboxes render as task checkboxes, raw only with the cursor inside". |
| CHK-5 | **Tapping a checkbox** toggles it (`[ ]`/`[-]` → `[x]`, `[x]` → `[ ]`) without moving the cursor or focusing the editor, so the mobile keyboard stays down. **Test:** "tapping a checkbox toggles it without moving the cursor or focusing". **Manual:** the keyboard staying down needs a phone. |
| CHK-6 | **Statistics:** checking or unchecking an item also checks or unchecks every box nested under it. Each parent box is then recomputed: `[x]` if all its boxed children are checked, `[-]` if some are checked or partly checked, `[ ]` if none are. `[n/m]` / `[n%]` cookies on items and on the section's heading are rewritten, counting direct children (Org's default; the heading counts top-level items). A cookie with nothing to count becomes `[0/0]` / `[0%]`. Percentages are rounded down. Each heading counts only its own section. **Test:** "toggling an item updates the heading cookie", "percent cookies and parent boxes follow their children", "checking a parent checks all its children", "each heading's cookie counts only its own section". |
| CHK-7 | A toggle and the recount it causes are **one transaction**, so one undo reverts both. Only the changed characters of each line are replaced, so the cursor stays put. **Test:** "toggling is a single undoable change". |
| CHK-8 | **Enter in a list item** (cursor at or after the item text, nothing selected) starts the next item at the same indentation. The bullet is repeated, ordered bullets count up (`2.` → `3.`), checkbox items get a new `[ ] `, and text after the cursor moves into the new item. Counters are recounted, in the same transaction. Enter on an empty item empties the line and ends the list. Anywhere else Enter is a normal newline. **Test:** "Enter continues a checklist with an unchecked item", "Enter splits an item at the cursor and numbers ordered lists", "Enter on an empty item ends the list", "Enter outside list items, or before the item text, is left to the default". |

Known gaps: Tab/Shift-Tab don't indent items, later items in an ordered list aren't renumbered, there's no `COOKIE_DATA: recursive`, and TODO-based counters on headings with no checkboxes aren't computed.

## 9. Shortcut bar and editing commands

`src/editor/shortcut-bar.ts` (the bar), `src/settings.ts` (`BUTTONS`), `src/view.ts` (`runButton`, `pickDate`), `src/org/edit.ts` (the actions). Tests in `test/edit.spec.ts` and `test/notes.spec.ts`.

### 9.1 The bar

| ID | Rule |
|---|---|
| BAR-1 | The bar is a CodeMirror panel at the **bottom** of the editor (`.org-shortcut-bar`), shown when `showShortcutBar` is on. On phones the app shrinks above the keyboard, so the bar sits just above it while typing. While the keyboard is closed, it is lifted clear of Obsidian's floating navigation bar. It's **one row that scrolls sideways** and never wraps. **Test:** "the shortcut bar is a panel at the bottom of the editor", "the shortcut bar is one row that scrolls sideways". **Manual:** its place above the keyboard and the navigation bar needs a phone. |
| BAR-2 | Buttons always appear in the order of `BUTTONS`: undo, redo, visibility, demote, promote, todo, schedule, deadline, checkbox, wiki-link, journal, journal-picker, journal-calendar, new-note. A button shows when its id is in `shortcutBarButtons`. Ids not in the list (such as the old `stars`) are ignored. **Test:** "bar buttons keep BUTTONS order and ignore unknown ids". |
| BAR-3 | Enabled by default: undo, redo, visibility, demote, promote, todo, schedule, deadline, checkbox, wiki-link. Off by default: journal, journal-picker, journal-calendar, new-note. Adding an off-by-default button doesn't change anyone's bar, so it needs no version bump (BAR-8). **Test:** "a fresh bar has the editing buttons on and the journal and note buttons off". |
| BAR-4 | **Focus:** tapping a button never takes focus away: the tap is handled on `touchend` (or `click` with `mousedown` prevented on desktop) with the default prevented, and a touch that moved (a swipe along the bar) does nothing. After the action, focus returns to the editor only for buttons with `refocus` (the ones that edit text) and only if the editor had focus before the tap. Visibility, journal, journal-picker, journal-calendar, schedule and deadline never bring up the mobile keyboard; new-note does, on purpose, so you can type the title (NOTE-1). Schedule and deadline give focus back when their date picker closes, if the editor had it. **Test:** "bar taps keep focus where it was; editing buttons give it back, swipes do nothing", "onTap runs on a still tap or a click, never on a swipe, and keeps focus away". **Manual:** the keyboard needs a phone. |
| BAR-5 | Undo and Redo are dimmed (`is-disabled`) when there's nothing to undo or redo. They can still be tapped and then do nothing. **Test:** "undo and redo are dimmed when there is nothing to undo or redo". |
| BAR-6 | The visibility button's icon and label follow the current level: `fold-vertical` (Fold all), `list-tree` (Outline), `unfold-vertical` (Expand all). Its icon can't be customised. There is **no** visibility button in the view header. **Test:** "the visibility button's icon and label follow the level". |
| BAR-7 | **Icons:** each button except visibility can be given any Lucide icon name in settings, with a live preview. An unknown name is marked in the settings and falls back to the default icon. **Test:** "a custom icon is used only when it names a known icon". **Manual:** the settings preview needs Obsidian. |
| BAR-8 | **Saved-list upgrade:** saved settings without `shortcutBarVersion` count as version 1. Before version 2, `undo`, `redo` and `visibility` are added at the front and `stars` removed, once. Before version 3, `id-link` is added at the end, once. Version 4 replaces `id-link` with `wiki-link` in the same place (a user who had turned `id-link` off does not get `wiki-link`). An upgraded list is saved straight away. After that the user's choices are kept, e.g. undo turned off stays off. A fresh install starts at the current version. **Test:** "migrateShortcutButtons enables undo/redo/visibility once and drops stars", "migrateShortcutButtons replaces id-link with wiki-link in place", "saved settings merge over copied defaults". Any future change to the default buttons needs its own version bump and upgrade step. |

### 9.2 Actions

A **heading** is a line that starts at column 0 with one or more `*` followed by whitespace or the end of the line. `*bold*` text is not a heading. All actions follow this rule.

| ID | Rule |
|---|---|
| ACT-1 | **Increase level (demote):** on a heading, adds one `*`. On any other line, prepends `* `. Applies to every line the selection touches. **Test:** "increaseHeadingLevel demotes headings and turns other lines into headings", "heading actions do not treat *bold* text as a heading". |
| ACT-2 | **Decrease level (promote):** removes one `*`. On a level-1 heading it removes `* ` and the line becomes plain text. It does nothing on other lines. Applies to every line the selection touches. **Test:** "decreaseHeadingLevel promotes, and a level-1 heading becomes text". |
| ACT-3 | **Cycle task state** has 3 states: none → first TODO keyword → first DONE keyword → none. *Any* configured TODO keyword (e.g. `DOING`, `WAITING`) goes straight to the first DONE keyword, and any DONE keyword to none. A non-heading line becomes `* TODO line` (its indentation dropped). The keyword is matched as the first word, exactly as configured. **Test:** "cycleTaskState cycles none -> TODO -> DONE -> none", "any open keyword goes straight to the first done keyword", "cycleTaskState on plain text turns it into a TODO heading". Kept 3-state deliberately: one tap closes a task in any open state. |
| ACT-4 | **Schedule / Deadline** open a date picker set to the heading's current date for that keyword, or today. On mobile, picking a date applies it immediately. On desktop it's applied with **Set** or Enter, because the date field reports half-typed dates. **Remove** shows only when a date exists. With no heading above the cursor, a notice appears and nothing opens. **Manual:** the date picker is an Obsidian dialog. |
| ACT-5 | **Where dates go:** the heading that encloses the cursor (searching upwards, so it works from body lines), on the line straight after it, which is the only place Org reads planning from. If that line is already a planning line (`SCHEDULED:`/`DEADLINE:`/`CLOSED:`, indentation allowed), the entry is added to the end of it or updated in place; otherwise a new line is inserted. A date is written as `<YYYY-MM-DD Ddd>` with English weekday names. Changing the date keeps any time and repeater (`<… Tue 10:00 +1w>`). Removing the last entry deletes the planning line, and removing one of several also removes the space between them. **Test:** "orgDateString adds the English weekday", "setPlanningDate inserts, updates and removes SCHEDULED under a heading", "setPlanningDate shares the planning line with other entries", "setPlanningDate works from a body line and keeps time and repeater", "setPlanningDate needs a heading and ignores *bold* text". |
| ACT-6 | **Checkbox:** plain line → `- [ ] line` (keeping indentation). List item → adds `[ ] `. `[ ]`/`[-]` → `[x]`, with CHK-6 statistics. `[x]` → box removed. Does nothing on headings or inside blocks. Every case recounts the counters. **Test:** "toggleCheckbox cycles plain text -> [ ] -> [x] -> none and recounts", "toggleCheckbox handles [X], [-], ordered lists and headings". |
| ACT-7 | **Toggle leading stars** (command only, no button): plain line → `* line`, heading → stars and space removed. **Test:** "toggleLeadingStars adds and removes stars". |
| ACT-8 | **ID link** (command only, no bar button): inserts `[[id:]]` in place of the selection (or at the cursor) and leaves the cursor right after `id:`, ready for the target ID (LP-9 then offers IDs). **Test:** "insertIdLink inserts [[id:]] with the cursor after the colon". |
| ACT-9 | **Wiki link:** inserts `[[]]` at the cursor with the cursor between the brackets, ready to type the target (the `[[` completion then offers notes by title and files, LP-9). With a selection, wraps it as `[[selection]]` and puts the cursor after it. This is the bar's link button (`wiki-link`); the command is "Insert wiki link". **Test:** "insertWikiLink inserts [[]] with the cursor between the brackets", "insertWikiLink wraps a selection and puts the cursor after it". |

### 9.3 Commands

Command ids are a **compatibility contract**: users' hotkeys are bound to them, so never rename one. They are the same ids `orgmode-cm6` used, so hotkey habits carry over (the bindings themselves are stored per plugin). Obsidian shows them prefixed with "Org Flex:".

| Command id | Name | Available |
|---|---|---|
| `cycle-orgmode-visibility` | Cycle visibility (fold all / outline / expand all) | in an org view |
| `org-toggle-stars` | Toggle leading stars (*) | in an org view |
| `org-increase-heading-level` | Increase heading level (+*) | in an org view |
| `org-decrease-heading-level` | Decrease heading level (-*) | in an org view |
| `org-cycle-task-state` | Cycle task state (none -> TODO -> DONE) | in an org view |
| `org-schedule-task` | Schedule task (SCHEDULED:) | in an org view |
| `org-deadline-task` | Task deadline (DEADLINE:) | in an org view |
| `org-toggle-checkbox` | Toggle checkbox (- [ ]) | in an org view |
| `org-insert-id-link` | Insert ID link ([[id:]]) | in an org view |
| `org-insert-wiki-link` | Insert wiki link ([[]]) | in an org view |
| `open-todays-journal` | Open today's journal | always |
| `browse-journal-entries` | Browse journal entries | always |
| `open-journal-calendar` | Open journal calendar | always |
| `new-org-note` | New org note | always |

There are also two ribbon icons: `file-plus` "New org note" and `calendar-days` "Open today's journal". A folder's context menu (long-press on mobile, right-click on desktop) has "New org note".

Known gaps: promote and demote change one line, not the whole subtree (dragging moves subtrees, §6a). Marking a task done doesn't add `CLOSED:`. Checkboxes don't count TODO children.

## 10. Journal

`src/org/journal.ts` (pure), `src/main.ts` (`openJournal`, `browseJournal`, `openCalendar`), `src/ui/modals.ts` (`JournalPickerModal`, `JournalCalendarModal`). Tests in `test/notes.spec.ts`. Setting `journalFolder` (default `journal`).

| ID | Rule |
|---|---|
| JRN-1 | Today's file is `<journalFolder>/YYYY/MM/YYYY-MM-DD.org`, using the **local** date. Leading and trailing slashes on the folder are ignored, and an empty folder means the vault root. **Test:** "journalDateString zero-pads month and day in local time", "journalPathForDate nests by year and month, tolerating slashes and an empty folder". |
| JRN-2 | **Open today's journal** opens that file in the current tab. If it doesn't exist, the missing folders are created one at a time and the file is created with the header below. That header matches the journal files migrated from Emacs, and the Emacs side (org-roam) relies on `:ID: YYYY-MM-DD` too. Errors show as a notice. **Test:** "journalFileContent uses the date as ID and title". |
| JRN-3 | **Browse journal entries** lists every `.org` file at any depth under the journal folder whose name is `YYYY-MM-DD.org`, newest first. Each is shown as `YYYY-MM-DD · Weekday, Month D`, so a date, weekday or month name can be searched. Choosing one opens it in the current tab. With no entries, a notice appears. **Test:** "journalEntries keeps dated files under the folder, newest first", "journal entries are labelled with weekday and month". |
| JRN-4 | **Journal calendar** (command `open-journal-calendar`, optional `journal-calendar` bar button) shows a month grid, starting on the locale's first weekday (Monday when the engine can't tell), with full weeks padded from the months around it. Days with a journal file (JRN-3 naming) have a dot, and today is highlighted. Arrows change the month, and **Today** returns to the current month. Tapping a day closes the calendar and opens that day's journal, creating it as in JRN-2 if needed. **Test:** "calendarMonth lays a month out in full weeks from the first weekday". |

```
:PROPERTIES:
:ID:       YYYY-MM-DD
:END:
#+title: YYYY-MM-DD
#+filetags: :journal:

```

## 10a. New org note

`src/org/new-note.ts` (pure), `src/main.ts` (`newNote`, `createNote`), `src/ui/modals.ts` (`NewNoteModal`). Tests in `test/notes.spec.ts`.

| ID | Rule |
|---|---|
| NOTE-1 | **Ways in:** the command `new-org-note`, the ribbon icon, a folder's context menu, and the optional `new-note` bar button. Each opens a dialog asking for a title, with the cursor already in the title box, so on mobile the keyboard opens. Enter or **Create** submits. **Manual:** needs Obsidian's commands, ribbon, menus and dialogs. |
| NOTE-2 | **Where:** the note goes in the folder whose menu was used. Otherwise it goes where Obsidian's *Default location for new notes* puts it (`fileManager.getNewFileParent`). The dialog says which folder. **Manual:** needs Obsidian's default location. |
| NOTE-3 | **Titles:** the title is trimmed and used **unchanged** as the file name (`<title>.org`) and the `#+title`. The `:ID:` is a new random UUID (`crypto.randomUUID()`, lowercase), as org-roam makes it; the note is linked by title through completion (LP-9). Spaces are allowed. Titles that are empty, contain `\ / : * ? " < > \| # ^ [ ]`, or start or end with `.` are refused with a reason, and nothing is created. **Test:** "titleProblem accepts ordinary titles, spaces included", "titleProblem rejects empty titles and characters that break files or links", "notePath puts the trimmed title in the folder". |
| NOTE-4 | **Nothing is overwritten:** if the file already exists, the dialog says so and creates nothing. The ID is a UUID, so it can't clash. **Manual:** needs the vault. |
| NOTE-5 | **Contents** follow the journal header (JRN-2), without filetags. The note opens in the current tab with the cursor below the header and the editor focused, ready to type. **Test:** "noteFileContent uses the UUID as ID and the title as #+title". |

```
:PROPERTIES:
:ID:       <title>
:END:
#+title: <title>

```

## 11. Org tasks in Markdown notes

`src/ui/tasks-block.ts` (code block processor), `src/org/tasks.ts`, `src/org/query.ts`. Tests in `test/tasks.spec.ts`.

| ID | Rule |
|---|---|
| TASK-1 | A Markdown ` ```orgmode-tasks ` block with YAML `filepath:` (required; a vault path, or a link resolved from the note) and `query:` (default `it.todo or it.done`) lists the tasks of that org file. Errors are shown in place of the block. **Test:** "a task block needs filepath: and defaults its query". **Manual:** rendering in a Markdown note needs Obsidian. |
| TASK-2 | **Tasks** are headings, at any depth, together with their keyword, title, priority and `SCHEDULED`/`DEADLINE`/`CLOSED` dates (with time, if given). Whether a task is TODO or DONE comes from the keyword settings. **Test:** "headings at any depth with keyword, priority and planning dates". |
| TASK-3 | Ticking a task's checkbox rewrites the keyword in the org file: DONE-type → `TODO`, anything else (including no keyword) → `DONE`. The file is updated with `vault.process` so concurrent edits aren't lost; if the heading is no longer on its line with the same title, nothing changes. The list re-renders whenever the org file changes. **Test:** "ticking flips done tasks to TODO and anything else to DONE". |
| TASK-4 | **Queries** use a subset of Orgzly's search language. Supported: <br>• `it.todo`, `it.done`, `it.none` (no keyword), and `i.<keyword>` for a keyword. <br>• `s.`, `d.`, `c.` for scheduled, deadline and closed, with an optional operator `eq ne lt le gt ge` (default `le` for s/d, `eq` for c) and a time `today`/`tod`, `tomorrow`/`tmrw`/`tom`, `yesterday`, `now`, `Nd`/`Nw`/`Nm`/`Ny` (N may be negative), or `none`/`no`. Dates compare by day, `now` by time. <br>• A leading `.` negates any condition. <br>• Sorting with `o.s`, `o.d`, `o.c`, `o.p`, `o.st` (`.o.…` sorts descending); missing values sort last, ties keep file order. Priority sorting uses `defaultPriority` for tasks without one; state sorting follows the keyword settings' order. <br>• `ad.N`: an agenda view of N days. <br>• Combine with `and`, `or`, a space (also and), and parentheses. The symbols `&` and `|` are rejected. **Test:** "state conditions and negation", "date conditions with operators and times", "and, or and parentheses", "sorting", "bad queries say why". |
| TASK-5 | **Agenda view:** tasks scheduled or due on each of the N days from today are listed under that day. Open tasks scheduled or due before today go under a first, translated "Overdue" heading (English when the language isn't known), and dates are formatted in Obsidian's language. **Test:** "agenda groups tasks by day, overdue first". |

## 12. Settings

`src/settings.ts` (defaults, upgrade), `src/ui/settings-tab.ts`, `src/main.ts` (`loadSettings`). Saved settings are merged over the defaults on load, and array and object defaults are copied so editing them never changes `DEFAULT_SETTINGS`. **Test:** "saved settings merge over copied defaults".

| Key | Default | Effect |
|---|---|---|
| `todoKeywords` | `TODO, DOING, WAITING, NEXT, PENDING` | Open-task keywords (PARSE-3, ACT-3, TASK-2) |
| `doneKeywords` | `DONE, CANCELLED, CANCELED, CANCEL, REJECTED, STOP, STOPPED` | Closed-task keywords |
| `defaultPriority` | `B` | Priority used when sorting tasks that have none |
| `hideStars` | `false` | LP-7 |
| `foldPropertyDrawers` | `true` | Drawers stay folded (FOLD-4); front matter starts collapsed (FM-4) |
| `defaultFoldLevel` | `foldall` | FOLD-5 (`foldall` / `outline` / `expandall`) |
| `showShortcutBar` | `true` | BAR-1 |
| `shortcutBarButtons` | BAR-3 list | BAR-2 |
| `shortcutCustomIcons` | `{}` | BAR-7 |
| `shortcutBarVersion` | `4` | BAR-8 (internal, not shown in settings) |
| `journalFolder` | `journal` | JRN-1 |
| `frontMatterPanel` | `true` | §7 |
| `backlinks` | `true` | §5a |
| `headingDragHandles` | `true` | §6a |

Keyword text areas accept commas or newlines; blank entries are dropped. **Test:** "keyword lists accept commas or newlines".

## 13. Layout and mobile requirements

Full background in `AGENTS.md`. Getting these wrong produces bugs that only show up on phones: the editor sliding off-screen, or the whole window shifting when the keyboard opens.

| ID | Rule |
|---|---|
| MOB-1 | Flex children with siblings use `flex: 1 1 0%; min-height: 0; height: auto`, **never** `height: 100%`. This applies to the view content, the editor and `.cm-scroller` next to the shortcut bar panel. **Test:** "flex children with siblings never use height: 100%". **Manual:** the layout needs a phone. |
| MOB-2 | `.view-header` and `.view-content` are `position: sticky; top: 0`, which stops CodeMirror's scroll-into-view from scrolling the whole window. Because the header stays in the layout, Obsidian's phone top spacing for floating headers (`--view-top-spacing`) is set to 0 for the org view, as Obsidian does for Markdown, so there is no gap between the header and the text. **Test:** "the header and content are sticky, and the phone's floating-header spacing is off". **Manual:** the layout needs a phone. |
| MOB-3 | `.cm-scroller` is the only scrolling element. On mobile it uses `overflow-y: scroll` and `-webkit-overflow-scrolling: touch`, with `overscroll-behavior-y: contain` and `touch-action: pan-y`. **Test:** "on mobile the editor's scroller is the one scrolling element". **Manual:** scrolling needs a phone. |
| MOB-4 | Any scroll on the outer containers (content, container, leaf, editor root, document) is reset to 0. This runs on scroll, visual viewport resize and focus events. **Test:** "lockOuterScroll puts outer containers back at the top". **Manual:** keyboard avoidance needs a phone. |
| MOB-5 | The view header and its title are forced visible, because some themes hide them. **Test:** "the view header and its title are forced visible". |
| MOB-6 | Plugin CSS that touches the editor is scoped to the org view (`.org-flex-view`, `[data-type="org-flex"]`) so it never changes Obsidian's Markdown editor. Dialog styles are scoped to their own classes, and the task list to `.org-tasks`. **Test:** "every style is scoped to the org view or the plugin's own classes". **Manual:** Markdown notes looking unchanged needs Obsidian. |
| MOB-7 | Anything tappable in the editor (links, checkboxes, the Properties header, backlinks, bar buttons) must not bring up the keyboard unless the tap is meant for editing text (FM-5 title and row clicks, editing buttons when the editor already had focus). They all use one helper, `onTap` in `src/editor/state.ts`: `mousedown` prevented, the action run on a still `touchend` (default prevented, which stops the focus and the synthetic click) or on `click`. **Test:** "onTap runs on a still tap or a click, never on a swipe, and keeps focus away". **Manual:** the keyboard needs a phone. |

## 14. Deployment notes

- **Desktop vault:** `npm run build && mkdir -p ~/base/personal/.obsidian/plugins/org-flex && cp main.js manifest.json styles.css ~/base/personal/.obsidian/plugins/org-flex/` (see `AGENTS.md`). Disable `orgmode-cm6` before enabling Org Flex (PLAT-3).
- **Phone:** the vault syncs through Syncthing, and `obsidian.stignore` **excludes `.obsidian`**. Plugin builds and CSS snippets therefore never reach the phone on their own. Copy the three files into the phone vault's `.obsidian/plugins/org-flex/` by hand, or install through a release channel such as BRAT.

## 15. Automated checks

Run before every commit. All of them must pass.

1. `npm test` — all tests pass (132 at the time of writing). `test/dom.spec.ts` mounts the whole editor in happy-dom, which catches decoration errors that pure tests can't.
2. `npx tsc --noEmit --skipLibCheck` — **no errors**.
3. `npm run build` — exits with status 0 (it runs the type-check too).

Every new behaviour gets a rule here and a test, unless it truly needs Obsidian or a phone; then it is **Manual:** with the reason, and gets a line in §16. Logic is kept out of `src/view.ts`, `src/main.ts` and `src/ui/` (which import Obsidian) so it can be tested: `src/editor/setup.ts`, `src/settings.ts` and `src/org/` hold it. `test/dom.spec.ts` and `test/ui.spec.ts` run the editor in happy-dom; `test/packaging.spec.ts` reads the manifest, build config and stylesheet; `test/spec.spec.ts` checks this file.

## 16. Manual checklist

These need Obsidian, ideally on a phone as well as the desktop. Go through them after changes that touch the area in brackets.

- [ ] With `orgmode-cm6` disabled, Org Flex enables without an error and `.org` files open in it. [PLAT-3]
- [ ] An org file opens with its text, and the tab shows its name. Edits are saved, also when the tab is closed right after typing. [VIEW-1..3]
- [ ] A fully folded file still scrolls. [VIEW-6]
- [ ] Turning *Vim key bindings* on applies on the next focus, and Enter in normal mode is Vim's. [VIEW-4, VIEW-5]
- [ ] Opening a large org file shows it at the default fold level, with no visible jump. [FOLD-5]
- [ ] The visibility button cycles three levels, and its icon and notice change each time. [FOLD-6, BAR-6]
- [ ] The bar sits just above the keyboard while typing and above the navigation bar otherwise. It scrolls sideways on a narrow phone, and a swipe doesn't trigger a button. [BAR-1, BAR-4]
- [ ] Tapping visibility, journal or browse with the keyboard closed doesn't open it. Tapping demote while typing keeps the keyboard open. [BAR-4, MOB-7]
- [ ] Typing an icon name in settings previews it; an unknown name is marked and the bar keeps the default icon. [BAR-7]
- [ ] Schedule on mobile: the native picker opens and one pick applies the date. [ACT-4]
- [ ] Tapping a checkbox toggles it with the keyboard staying closed, and counters update. [CHK-5, CHK-6]
- [ ] Enter after a `- [ ]` item continues the list, in normal mode and in vim insert mode. [CHK-8, VIEW-5]
- [ ] A journal file shows a big title and a collapsed "Properties 2". Tapping a row shows the raw text; tapping into the body brings the panel back. [FM-2..5]
- [ ] Markup markers and link targets hide and reappear as the cursor leaves and enters them; `[[pkm][pkm]]` shows `pkm`. [LP-1, LP-2]
- [ ] Source blocks in python, js and json are coloured, and the `#+end_src` line disappears when the cursor is elsewhere. [PARSE-4, LP-4]
- [ ] Opening the keyboard doesn't shift the window or hide the header, and the editor stays the only thing that scrolls. [MOB-1..4]
- [ ] Markdown notes look unchanged: search panel, headings, checkboxes. [MOB-6]
- [ ] Misspelled words in an org file get the spellcheck underline, and none after turning off Editor → Spellcheck and reopening the file. [VIEW-8]
- [ ] Editing the open file in Emacs (Syncthing) updates the view without losing the cursor or folds. [VIEW-9]
- [ ] Tapping `[[id:…]]` links opens the right file and entry with the keyboard closed; `[[file]]` and image links work. [LINK-1..3, LP-3]
- [ ] A note with backlinks shows "Linked mentions" at the end, also when the last heading is folded. Tapping a line opens that file on that line with the keyboard closed. [BL-1, BL-4, BL-5]
- [ ] Typing `[[` lists notes and headings by title with no UUIDs; picking one inserts `[[id:…][Title]]`, shown as the title. A new note gets a UUID `:ID:`. [LP-9, NOTE-3]
- [ ] Opening "Unlinked mentions" lists plain-text mentions; **Link** turns one into a link in the other file, and it then moves to "Linked mentions". [BL-2, BL-3]
- [ ] `[[id:…]]` links open instantly on the phone, also right after the app starts (once the index is built). [IDX-1, LINK-3]
- [ ] Dragging a heading's grip on the phone moves it with its children, without scrolling or selecting text; the editor scrolls near the edges; one undo puts it back. [DRAG-1..4]
- [ ] The journal calendar marks days with entries; tapping a past day without one creates it with the journal header. [JRN-4]
- [ ] Turning a setting on or off applies to open views without reopening them. [VIEW-7]
- [ ] On the phone, "New org note" from the ribbon, and from long-pressing a folder, creates the note, opens it and leaves the cursor below the header. A title already used shows the reason in the dialog. [NOTE-1..5]
- [ ] An `orgmode-tasks` block lists tasks, ticking one updates the org file, and `ad.7` shows an agenda. [TASK-1..5]

## 17. Keeping this file current

- A change that alters behaviour updates the matching rule in the **same commit**. A new feature gets a new section or new IDs, and a removed feature has its rules deleted.
- Never reuse a deleted ID for something else; pick a new number.
- Decisions the user made on purpose are recorded with the rule, so they aren't undone later. Examples: the 3-state TODO cycle (ACT-3), no visibility button in the header (BAR-6), `[[X]]` not being an ID link (LINK-4), and the journal header (JRN-2).
