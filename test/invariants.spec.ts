// @vitest-environment happy-dom
// §0 invariants: the guards a tailored fork must keep green. A fork may
// rewrite any other rule; these say what every flavour of Org Flex keeps.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { orgConfig, orgHost, DEFAULT_CONFIG, OrgHost } from "../src/editor/state";
import { coreExtensions } from "../src/editor/setup";
import { applyVisibility } from "../src/editor/folding";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

// ---------------------------------------------------------------- INV-1

test("opening a file in the editor and saving it changes nothing", () => {
  const text = read("test/fixtures/everything.org");
  const host: OrgHost = { setIcon() {}, openLink() {}, imageSrc: () => null, linkCompletions: () => [], idCompletions: () => [] };
  for (const level of ["foldall", "outline", "expandall"] as const) {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: text,
        selection: EditorSelection.cursor(0),
        extensions: [orgConfig.of({ ...DEFAULT_CONFIG, keywords: { todo: ["TODO", "NEXT"], done: ["DONE"] } }), orgHost.of(host), coreExtensions({ spellcheck: true })],
      }),
    });
    applyVisibility(view, level);
    // the cursor walks the whole file, as reading it does
    for (let pos = 0; pos <= view.state.doc.length; pos += 37) view.dispatch({ selection: EditorSelection.cursor(pos) });
    expect(view.state.doc.toString(), level).toBe(text);
    view.destroy();
  }
});

// ---------------------------------------------------------------- INV-2

/**
 * Raw tap listeners in the editor, outside onTap, that are allowed, each
 * with the reason. Anything else tappable must go through onTap.
 */
const RAW_TAPS: Record<string, string> = {
  // onTap itself
  "src/editor/state.ts": "defines onTap",
  // tapping the title or a property is meant to start editing that line, keyboard included
  "src/editor/front-matter-panel.ts": "edits the tapped line on purpose",
  // a drag, not a tap: pointer capture, and the gesture is swallowed (CHK-9)
  "src/editor/list-drag.ts": "drags list items",
};

test("everything tappable in the editor goes through onTap, so a tap never brings up the keyboard", () => {
  const offenders: string[] = [];
  for (const file of [...sources("src/editor"), "src/view.ts"]) {
    if (file in RAW_TAPS) continue;
    const text = read(file);
    for (const m of text.matchAll(/addEventListener\(\s*"(click|mousedown|mouseup|touchstart|touchend|pointerdown|pointerup)"/g)) {
      offenders.push(`${file}: ${m[1]}`);
    }
  }
  expect(offenders).toEqual([]);
});

// ---------------------------------------------------------------- INV-4

/**
 * Every command id ever shipped. Users' hotkeys are bound to these, so a
 * fork may add ids here but never remove one: each stays registered, or, when
 * a fork drops the feature that had it (PLAT-8), moves to RETIRED_COMMAND_IDS
 * and is never used again.
 */
const SHIPPED_COMMAND_IDS = [
  "cycle-orgmode-visibility", "org-toggle-stars", "org-insert-heading", "org-increase-heading-level",
  "org-decrease-heading-level", "org-cycle-task-state", "org-schedule-task", "org-deadline-task",
  "org-toggle-checkbox", "org-insert-src-block", "org-insert-quote-block", "org-insert-id-link",
  "org-insert-wiki-link", "org-zoom", "org-toggle-reading", "org-roam-node-find", "org-assign-id",
  "open-todays-journal", "browse-journal-entries", "open-journal-calendar", "new-org-note", "org-capture",
];

/** Ids whose feature this copy dropped; they may never be registered again, for anything. */
const RETIRED_COMMAND_IDS: string[] = [];

function registeredCommandIds(): string[] {
  const ids: string[] = [];
  for (const file of sources("src")) {
    const text = read(file);
    for (const m of text.matchAll(/addCommand\(\{\s*id:\s*"([a-z0-9-]+)"/g)) ids.push(m[1]);
    for (const m of text.matchAll(/\binView\(\s*"([a-z0-9-]+)"/g)) ids.push(m[1]);
  }
  return ids;
}

test("every command id ever shipped is still registered or retired, and the spec lists exactly the registered ones", () => {
  const registered = registeredCommandIds();
  expect(SHIPPED_COMMAND_IDS.filter((id) => !registered.includes(id) && !RETIRED_COMMAND_IDS.includes(id))).toEqual([]);
  expect(RETIRED_COMMAND_IDS.filter((id) => registered.includes(id) || !SHIPPED_COMMAND_IDS.includes(id))).toEqual([]);
  expect(registered.filter((id, i) => registered.indexOf(id) !== i)).toEqual([]);
  const spec = read("SPEC.md");
  const table = spec.slice(spec.indexOf("### 9.3 Commands"), spec.indexOf("Known gaps", spec.indexOf("### 9.3 Commands")));
  const listed = Array.from(table.matchAll(/^\| `([a-z0-9-]+)` \|/gm), (m) => m[1]);
  expect([...listed].sort()).toEqual([...registered].sort());
});
