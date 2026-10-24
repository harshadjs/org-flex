# Tailoring Org Flex

Org Flex is not meant to be one plugin with every Org option behind a setting. It is a base that each person's own copy grows from: a fork, changed by its owner's coding agent, to fit how that one person uses Org. This file tells that agent how to do it. Read `AGENTS.md` and the parts of `SPEC.md` you will touch first.

What makes a fork safe to change is the spec. Every behaviour is a numbered rule with its tests. Change the rule, change the code, change the tests, and the checks tell you whether the rest still holds.

## A fork or a branch

A copy can be a fork, or a branch of its own in the base repository (for example `harshad`), which suits the base's own author:
- **The base stays on `main`:** keep base work there, and merge `main` into the flavour branch to pick it up. Resolve conflicts in favour of the flavour's rules, using the rule IDs in the commits.
- **Flavour-only changes:** the flavour's `FLAVOUR.md`, `src/flavour.ts`, dropped features and changed rules are committed on the flavour branch only, never on `main`.
- **No releases from a flavour branch:** tags and GitHub releases are the base's; a release made from a flavour would become the one everybody else installs. A flavour reaches its owner's vaults with `npm run deploy` (and by copying the three files to other devices).

## What never changes

`SPEC.md` §0 lists four invariants that hold in every fork, each with guard tests:

- **INV-1:** files stay plain Org, readable by Emacs, Orgzly and other Org tools.
- **INV-2:** the editor is phone-first: taps go through `onTap`.
- **INV-3:** every rule names its tests or its manual check.
- **INV-4:** command ids are never renamed or reused.

If a request can only be met by breaking one, say so and offer the nearest thing that doesn't. Every other rule is a default you may rewrite.

## Where things live

| To change | Edit |
|---|---|
| Keywords, priorities, what is folded or hidden, templates | `src/flavour.ts` and SPEC §12a |
| A whole feature: journal, capture, backlinks, attachments... | `src/features/<id>.ts`, its SPEC section, `src/features/index.ts` (PLAT-8) |
| Something that differs between the person's own vaults or devices | `src/settings.ts`, the settings tab and SPEC §12. Keep this rare |
| Editing behaviour: lists, headings, links, folding | `src/org/` (pure logic) and `src/editor/` (CodeMirror), with their SPEC sections |

Prefer changing code over adding a setting. The person can ask you again when they change their mind, and a setting nobody else toggles is just code that's harder to read.

## 1. Interview

Org is less one tool than the sum of the Emacs packages, habits and conventions a person has built up around it. Two people who both "use Org" may share almost nothing: one has a denote archive of small files with dated names, another one big outline per project, `org-attach` folders and a custom agenda. So the interview is about **what they actually use and how**, starting from Emacs if they use it, and it stays open: the areas below are prompts, not a menu. Anything the person mentions, follow up on.

### Start from what they have

Before asking anything, ask for, and read:
- their Org configuration: `init.el`, `config.org`, or the Org part of a Doom or Spacemacs config;
- a few typical files: a note, a project or task file, a journal day, a file with attachments.

Most answers are in there: keywords, capture templates, the file-naming scheme, link types, drawers, which packages are loaded. Then your questions confirm and explain instead of discovering, and you don't ask what you can already see.

If they don't use Emacs, ask the same things about the tools they do use (Orgzly, beorg, Logseq's Org mode, plain Obsidian), or about how they want to work.

### For each package or habit, three questions

1. **What is it for, for them?** The same package serves different people differently. org-roam can be a zettelkasten for one person and only an ID-link system for another.
2. **What does it leave in the files?** File names, properties, drawers, keywords, link types (`id:`, `denote:`, `attachment:`, `cite:`), directives (`#+transclude:`, `#+INCLUDE:`), directory layout. Org Flex can only work with what is in the files, and it must keep all of it intact (INV-1).
3. **What do they need from it in Obsidian, and on which device?** Seeing it rendered, following it, creating it, or editing it. Often reading and following on the phone is enough, and creating can stay in Emacs.

### Areas to explore

Ask about the areas that fit the person. Leave out what plainly doesn't apply, and don't stop at these examples.

- **Notes and linking.**
  - org-roam: `:ID:` properties, `ROAM_ALIASES`, `ROAM_REFS`, dailies, node capture templates, how nodes are titled and filed.
  - denote: file names like `20261024T091500--title__tag1_tag2.org`, `denote:` links, front matter, signatures, keywords in the name.
  - Plain `org-id`, howm, file links only, one big file with headings as notes.
  - How a new note is named and where it goes; how they find notes again.
- **Attachments.**
  - `org-attach`: per-heading folders from `:ID:` (`data/ab/cdef…`), `ATTACH_DIR` or `DIR` properties, `attachment:` links, `org-attach-id-dir`, the method (copy, move, link).
  - `org-download`: screenshots and `#+DOWNLOADED:`.
  - Plain `file:` links into an attachments folder.
  - What they attach (photos, PDFs, audio), and whether they attach from the phone.
- **Transclusion and composition.** `org-transclusion` (`#+transclude: [[id:…]]` with `:level`, `:only-contents`, `:lines`), `#+INCLUDE:`, and embedding parts of other notes. Should Org Flex show the transcluded text inline, and read-only or editable?
- **Tasks and agenda.**
  - Keywords, globally or per file (`#+TODO:`), and their meaning.
  - Priorities, tags and tag inheritance, effort, `org-log-done`, and the `LOGBOOK` drawer (`org-log-into-drawer`).
  - Repeaters and `org-habit`, clocking.
  - How they review: `org-agenda` custom commands, `org-super-agenda`, `org-ql` queries.
  - Refiling (`org-refile` targets) and archiving (`org-archive`, `_archive` files).
- **Capture and journaling.**
  - `org-capture` templates: ask them to paste them, since each template is a requirement.
  - `org-journal`, `org-roam-dailies`, or date trees (`file+olp+datetree`).
  - What a new day or entry looks like.
- **Writing and reference.**
  - Citations: `org-cite` or `citar` (`cite:` links, bibliography files), and `org-noter` for PDF notes.
  - Babel: which languages, and whether `#+RESULTS:` matters.
  - Export: `ox-hugo` front matter and other export settings that live in the file.
  - Tables, LaTeX fragments, footnotes.
- **Looks.** `org-modern`, `org-superstar`, `org-hide-emphasis-markers`, `olivetti`, `org-indent-mode`, mixed-pitch fonts. These say how they expect the live preview to look.
- **Sync and other devices.** Syncthing, git or a cloud folder; whether Orgzly or beorg also edit the same files. That is what Org Flex must not disturb.
- **Their own Elisp.** Commands, hooks or conventions they wrote themselves, which are often the most personal part of their workflow.
- **Pain.** What annoys them today, in Emacs on the phone, in Org Flex, or in whatever they used before.

Finally, go through the features in `src/features/index.ts` and ask whether to keep, change or drop each. Unused features mean a busier bar and settings.

### Sort what you learned

Put each thing you heard in one of these groups:
- **Already works:** say so, and note it in `FLAVOUR.md`.
- **A flavour value:** keywords, templates, folding (`src/flavour.ts`).
- **A change to an existing feature or rule:** name the rule IDs.
- **A new feature:** for example `denote` (dated file names, `denote:` links), `org-attach` (resolve `attachment:` links through the heading's `:ID:` folder), or `transclusion` (render `#+transclude:` read-only).
- **Not possible, or not wise:** something that would break an invariant, or need Emacs itself (running Babel, for instance). Say why, and offer the nearest thing.
- **Later:** wishes the person doesn't need now, kept under a "Wishes" heading in `FLAVOUR.md` so they aren't lost.

Then write a short proposal and get a yes before you build:
- each feature, marked keep, change, drop or new;
- the flavour values;
- the rules you will add, change or delete, by ID;
- what you won't do, and why.

Build the most-used things first. A first round can be small; the person can run `/tailor` again.

## 2. Record the person

Write `FLAVOUR.md` at the repository root: who this copy is for, how they use Org in their own words, the decisions from the interview and why. Later agents read it before changing anything, so they don't ask again. Update it whenever a decision changes. The base ships a `FLAVOUR.md` describing the base; replace it.

## 3. Change the spec first

For each change, edit `SPEC.md` before the code:
- **A rule that changes:** rewrite it in place, keeping its ID.
- **A new rule:** give it the next ID in its section.
- **A dropped feature:** delete its section and every rule that only it had. Fix references elsewhere (the commands table §9.3, the bar buttons BAR-2 and BAR-3, the §16 checklist, the settings table).
- **Tests:** every rule you write cites a **Test:** (a test name you will write) or a **Manual:** (with a §16 checklist line).

Keep the spec describing this fork, not the base. It is the fork's contract now.

## 4. Build

- **Flavour:** edit `src/flavour.ts`.
- **Dropping a feature:**
  1. Delete its line in `src/features/index.ts` and its file.
  2. Delete the pure logic, dialogs and tests only it used.
  3. Delete its SPEC section.
  4. Move its command ids to `RETIRED_COMMAND_IDS` in `test/invariants.spec.ts` (INV-4).
  5. Remove its bar buttons from `BUTTONS` in `src/settings.ts`, or leave them; a button nothing runs never shows.
- **A new feature:**
  1. Write `src/features/<id>.ts` exporting a `Feature` (`src/features/feature.ts`).
  2. Put its pure logic in `src/org/` with tests.
  3. Give it its own SPEC section naming the file.
  4. Add it to `FEATURES`.
  5. Give any command a new id, added to `SHIPPED_COMMAND_IDS`.
- **Core behaviour:** pure logic in `src/org/` with unit tests; editor behaviour in `src/editor/` with happy-dom tests (`test/ui.spec.ts` shows how); Obsidian glue in `src/view.ts`, `src/main.ts` or the feature file, kept thin.
- **Starting points:** see `recipes/` for worked examples of each kind of change.

## 5. Check and hand over

1. `npm test` and `npm run build` must pass, the §0 guards included.
2. `npm run deploy` puts the build in the person's vault (`.deploy.json`, see AGENTS.md).
3. List the §16 checklist lines your change added or touched, so the person can try them in Obsidian, on the phone where it matters.
4. Commit when the person asks, with the rule IDs in the message.

## Sharing a fork

A fork used only by its owner can keep the id `org-flex`. One published for others needs its own plugin id and name (PLAT-1 is a default rule: change it on purpose, once, before anyone installs it).
