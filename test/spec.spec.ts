// SPEC.md itself: every rule says how it is checked (§0, §15).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(__dirname, "..");
const spec = readFileSync(join(root, "SPEC.md"), "utf8");

const rules = Array.from(spec.matchAll(/^\| ([A-Z]+-\d+) \| (.*) \|$/gm), (m) => ({ id: m[1], text: m[2] }));

const testNames = new Set(readdirSync(join(root, "test"))
  .filter((f) => f.endsWith(".ts"))
  .flatMap((f) => Array.from(readFileSync(join(root, "test", f), "utf8").matchAll(/\btest\("((?:[^"\\]|\\.)*)"/g), (m) => m[1])));

/** IDs a §16 checklist item names: `[FM-2..5, MOB-6]` → FM-2, FM-3, FM-4, FM-5, MOB-6. */
function checklistIds(): Set<string> {
  const section = spec.slice(spec.indexOf("## 16."), spec.indexOf("## 17."));
  const ids = new Set<string>();
  for (const [, refs] of section.matchAll(/\[([A-Z]+-[^\]]*)\]\s*$/gm)) {
    for (const ref of refs.split(",").map((r) => r.trim())) {
      const m = /^([A-Z]+)-(\d+)(?:\.\.(\d+))?$/.exec(ref);
      if (!m) continue;
      for (let n = Number(m[2]); n <= Number(m[3] ?? m[2]); n++) ids.add(`${m[1]}-${n}`);
    }
  }
  return ids;
}

test("every spec rule names its tests or says why it is manual", () => {
  expect(rules.length).toBeGreaterThan(90);
  const untagged = rules.filter((r) => !/\*\*Test:\*\*/.test(r.text) && !/\*\*Manual:\*\*/.test(r.text)).map((r) => r.id);
  expect(untagged).toEqual([]);
  const ids = rules.map((r) => r.id);
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
});

test("every test the spec cites exists", () => {
  const missing: string[] = [];
  for (const rule of rules) {
    const cited = /\*\*Test:\*\*(.*?)(?:\*\*Manual:\*\*|$)/.exec(rule.text)?.[1] ?? "";
    for (const [, name] of cited.matchAll(/"([^"]+)"/g)) if (!testNames.has(name)) missing.push(`${rule.id}: ${name}`);
  }
  expect(missing).toEqual([]);
});

test("every manual rule is on the manual checklist, and the checklist names real rules", () => {
  const listed = checklistIds();
  const known = new Set(rules.map((r) => r.id));
  const manual = rules.filter((r) => /\*\*Manual:\*\*/.test(r.text)).map((r) => r.id);
  expect(manual.filter((id) => !listed.has(id))).toEqual([]);
  expect(Array.from(listed).filter((id) => !known.has(id))).toEqual([]);
});

// ---------------------------------------------------------------- §0 invariants

test("the invariants are listed first and each one is guarded", () => {
  const section = spec.slice(spec.indexOf("## 0. Invariants"), spec.indexOf("## 1."));
  const ids = Array.from(section.matchAll(/^\| (INV-\d+) \|/gm), (m) => m[1]);
  expect(ids).toEqual(["INV-1", "INV-2", "INV-3", "INV-4"]);
  // an invariant is never only manual: some automated guard stands behind it
  for (const rule of rules.filter((r) => r.id.startsWith("INV-"))) expect(rule.text, rule.id).toMatch(/\*\*Test:\*\*/);
});
