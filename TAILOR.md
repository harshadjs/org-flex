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

Before changing anything, find out how this person works. Ask in short rounds of a few questions, with concrete choices where you can (your agent's question tool, if it has one). Don't ask what you can see in their vault or their existing fork. Cover:

1. **What Org is for them:** tasks and GTD, a personal wiki or zettelkasten (org-roam style), a daily journal, project notes, writing, reference. Most people are two or three of these, so ask which matters most.
2. **Other tools:** Emacs (which packages: org-roam, org-agenda, org-capture templates, org-journal), Orgzly, beorg, or Obsidian only. Their conventions decide IDs, file layout and keywords. If they use Emacs, ask for the relevant bits of their config; it answers many of the questions below.
3. **Devices:** phone, desktop or both, and what they do on each (capture on the phone, review on the desktop?).
4. **Tasks:** their keywords and the order they cycle in, priorities, whether DONE should log `CLOSED:`, repeaters, how they review (agenda, task blocks in Markdown notes).
5. **Notes and links:** ID links or file links, one file per note or big outline files, how new notes are named and where they go.
6. **Journal and capture:** daily files or a date tree, the header a new day gets, where captured things go and what they look like.
7. **Each feature in `src/features/index.ts`:** keep it, change it, or drop it. Name the ones they'd never use; fewer features means a simpler bar and settings.
8. **Pain:** what annoys them today, in Org Flex or in what they used before.

Then write a short proposal and get a yes before you build:
- each feature, marked keep, change, drop or new;
- the flavour values;
- the rules you will add, change or delete, by ID;
- anything you won't do because it would break an invariant.

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
