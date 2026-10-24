# Repository Guidelines & Workflow

## Project Overview
This repository contains the Org Flex Obsidian plugin (ID: `org-flex`): Org mode editing, live preview, folding, checklists, a journal, backlinks and task lists in Obsidian, built on its own bundled CodeMirror 6 editor and made to work as well on a phone as on the desktop.

## Behaviour Spec
`SPEC.md` is the contract for how the plugin behaves. Read the sections your change touches before changing anything. Any change that alters behaviour must update the matching rule in the same commit. Finish with the checks in its §15 (tests, type-check, build). Every rule must be testable: it names its tests (**Test:**) or says why only a person in Obsidian can check it (**Manual:**, with a line in the §16 checklist); `test/spec.spec.ts` enforces this. The four invariants in its §0 (plain Org, phone-first taps, testable rules, permanent command ids) hold in every fork and are guarded by `test/invariants.spec.ts` and `test/spec.spec.ts`; every other rule is a default you may rewrite when the user asks. Keep logic out of the Obsidian-importing files (`src/view.ts`, `src/main.ts`, `src/ui/`) so it can be tested.

## Settings and flavour
Settings (`src/settings.ts`, the settings tab) hold only what differs between one person's vaults and devices. How the user works with Org (keywords, templates, what is shown or folded, which features are on) is the flavour, `src/flavour.ts` (SPEC §12a): change it there, in code, when the user asks, rather than adding a setting.

## Layout
- `src/org/` — pure Org logic (parsing, lists, editing commands, folding rules, front matter, journal, notes, index, task queries). No Obsidian imports; tested directly.
- `src/editor/` — CodeMirror extensions (live preview, folding, checklists, list dragging, front matter panel, backlinks section, shortcut bar, completion).
- `src/features/` — the optional parts (journal, capture, backlinks, attachments...), one file each, listed in `src/features/index.ts` (SPEC PLAT-8). Add, change or drop whole features here.
- `src/ui/` — Obsidian dialogs, the settings tab and the `orgmode-tasks` block.
- `src/view.ts` — the org file view; `src/main.ts` — the plugin.
- `test/` — vitest; `dom.spec.ts` and `ui.spec.ts` run the editor in happy-dom, `packaging.spec.ts` reads the manifest, build config and CSS, `spec.spec.ts` checks SPEC.md.

## Obsidian Vault Integration & Deployment

- **Vault:** set in the git-ignored `.deploy.json` (`{"vault": "~/my-vault", "specCopy": "attachments/org-flex-SPEC.md"}`) or the `OBSIDIAN_VAULT` environment variable. Never commit a personal path.
- **Plugin directory:** `<vault>/.obsidian/plugins/org-flex`
- **Artifacts:** `main.js`, `manifest.json`, `styles.css`
- Only one plugin can own `.org` files: disable `orgmode-cm6` (or any other org plugin) before enabling Org Flex.

```bash
npm install          # .npmrc sets legacy-peer-deps (obsidian pins CodeMirror versions)
npm test
npm run build        # tsc --noEmit, then esbuild
npm run deploy       # build, copy the three artifacts to the vault, and SPEC.md to specCopy when set
npm run dev          # watch mode
npm version patch    # release: bumps manifest.json and versions.json; push the tag for a draft GitHub release
```

When `specCopy` is set, the vault keeps a live copy of the spec there. Whenever `SPEC.md` changes, refresh it with `npm run deploy`. Never edit the vault copy; it is overwritten.

A vault synced without `.obsidian` (e.g. a Syncthing ignore) doesn't get plugin builds: copy the three files by hand or install through BRAT.

## Obsidian Mobile & CodeMirror 6 Layout Guidelines

### 1. Flexbox Containment & Zero-Overflow
- Never set `height: 100%` on flex children that have siblings. `.workspace-leaf-content` is a flex column with `.view-header` and `.view-content`; `height: 100%` overflows by the header's height. Use `flex: 1 1 0% !important; min-height: 0 !important; height: auto !important;`. The same applies inside `.cm-editor` between the top panels (shortcut bar, search) and `.cm-scroller`.

### 2. CodeMirror 6 `scrollRectIntoView` & Window Panning
- CodeMirror's scroll-into-view walks up the parents until it meets `position: sticky` or `fixed`. `position: sticky; top: 0` on `.view-content` and `.view-header` stops it from scrolling the leaf, the workspace or the window when the keyboard opens.

### 3. Mobile Touch Scrolling (`.is-mobile`)
- `.cm-scroller` is the only scrolling container: `overflow-y: scroll; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y`. `scrollPastEnd()` keeps folded documents scrollable.

### 4. Parent Container Scroll Locking
- Mobile keyboard avoidance can set `scrollTop > 0` on outer containers. The view resets them to 0 on scroll, visual viewport resize and focus.

### 5. Theme & Header Resilience
- Some themes hide `.view-header` titles; the plugin forces them visible.

### 6. Taps that must not open the keyboard
- Use `onTap` (`src/editor/state.ts`) for anything tappable inside the editor: it prevents `mousedown`, runs the action on a still `touchend` with the default prevented, and on `click` for mice.
