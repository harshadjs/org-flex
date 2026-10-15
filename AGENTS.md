# Repository Guidelines & Workflow

## Project Overview
This repository contains the Org Flex Obsidian plugin (ID: `org-flex`): Org mode editing, live preview, folding, checklists, a journal, backlinks and task lists in Obsidian, built on its own bundled CodeMirror 6 editor and made to work as well on a phone as on the desktop.

## Behaviour Spec
`SPEC.md` is the contract for how the plugin behaves. Read the sections your change touches before changing anything. Any change that alters behaviour must update the matching rule in the same commit. Finish with the checks in its §15 (tests, type-check, build).

## Layout
- `src/org/` — pure Org logic (parsing, lists, editing commands, folding rules, front matter, journal, notes, index, task queries). No Obsidian imports; tested directly.
- `src/editor/` — CodeMirror extensions (live preview, folding, checklists, front matter panel, backlinks, heading drag, shortcut bar, completion).
- `src/ui/` — Obsidian dialogs, the settings tab and the `orgmode-tasks` block.
- `src/view.ts` — the org file view; `src/main.ts` — the plugin.
- `test/` — vitest; `test/dom.spec.ts` mounts the whole editor in happy-dom.

## Obsidian Vault Integration & Deployment

- **Obsidian Vault Location**: `~/base/personal`
- **Plugin Directory**: `~/base/personal/.obsidian/plugins/org-flex`
- **Artifacts**: `main.js`, `manifest.json`, `styles.css`
- Only one plugin can own `.org` files: disable `orgmode-cm6` before enabling Org Flex.

```bash
npm install          # .npmrc sets legacy-peer-deps (obsidian pins CodeMirror versions)
npm test
npm run build        # tsc --noEmit, then esbuild
npm run deploy       # build, copy the three artifacts to the vault, copy SPEC.md to the vault
npm run dev          # watch mode
```

The vault keeps a live copy of the spec at `~/base/personal/attachments/org-flex-SPEC.md`. Whenever `SPEC.md` changes, refresh it (`npm run deploy`, or `cp SPEC.md ~/base/personal/attachments/org-flex-SPEC.md`). Never edit the vault copy; it is overwritten.

The phone vault doesn't sync `.obsidian` (Syncthing ignore), so copy the three files there by hand or use BRAT.

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
