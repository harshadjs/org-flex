// Rules about the manifest, the build and the stylesheet, checked by reading
// the files themselves.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { VIEW_TYPE } from "../src/editor/setup";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

function sources(dir = "src"): string[] {
  return readdirSync(join(__dirname, "..", dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(__dirname, "..", path)).isDirectory() ? sources(path) : [path];
  });
}

interface CssRule { selectors: string[]; decls: Record<string, string> }

const css: CssRule[] = (() => {
  const text = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).replace(/!important/, "").trim();
    }
    rules.push({ selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")), decls });
  }
  return rules;
})();

/** The value of `prop` in the rules for `selector` (later rules win). */
function style(selector: string, prop: string): string | undefined {
  let value: string | undefined;
  for (const rule of css) if (rule.selectors.includes(selector) && prop in rule.decls) value = rule.decls[prop];
  return value;
}

const CONTENT = '.workspace-leaf-content[data-type="org-flex"] > .view-content.org-flex-view';
const HEADER = '.workspace-leaf-content[data-type="org-flex"] > .view-header';

// ---------------------------------------------------------------- PLAT

test("the plugin id is org-flex, and it names the view type", () => {
  expect(manifest.id).toBe("org-flex");
  expect(VIEW_TYPE).toBe(manifest.id);
});

test("the manifest targets desktop and mobile, and no API newer than 1.5.7 is used", () => {
  expect(manifest.isDesktopOnly).toBe(false);
  expect(manifest.minAppVersion).toBe("1.5.7");
  // methods Obsidian added after 1.5.7
  const newer = /\.(getAllFolders|getLanguage)\(/;
  for (const file of sources()) expect(newer.exec(read(file))?.[0], file).toBeUndefined();
});

test("the versions agree, and the manifest is fit for the community directory", () => {
  const versions = JSON.parse(read("versions.json"));
  expect(pkg.version).toBe(manifest.version);
  expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  expect(pkg.scripts.version).toContain("scripts/version-bump.mjs");
  expect(read(".npmrc")).toContain('tag-version-prefix=""');
  expect(manifest.description).not.toMatch(/obsidian|^this plugin/i);
  expect(manifest.description).toMatch(/\.$/);
  expect(manifest.name).not.toMatch(/obsidian/i);
  expect(read("LICENSE")).toMatch(/^MIT License/);
  const release = read(".github/workflows/release.yml");
  for (const step of ["npm test", "npm run build", "main.js manifest.json styles.css"]) expect(release).toContain(step);
});

test("CodeMirror is bundled: only obsidian and electron stay external", () => {
  const external = /external:\s*\[([^\]]*)\]/.exec(read("esbuild.config.mjs"))![1];
  expect(external.replace(/\s/g, "")).toBe('"obsidian","electron"');
  expect(Object.keys(pkg.dependencies)).toContain("@codemirror/view");
  // the obsidian package is only for types
  expect(Object.keys(pkg.dependencies)).not.toContain("obsidian");
});

test("the build type-checks then bundles, and deploys exactly the three artifacts", () => {
  expect(pkg.scripts.build).toBe("tsc --noEmit --skipLibCheck && node esbuild.config.mjs production");
  expect(read(".npmrc")).toContain("legacy-peer-deps=true");
  expect(pkg.scripts.deploy).toBe("npm run build && node scripts/deploy.mjs");
  const deploy = read("scripts/deploy.mjs");
  expect(deploy).toContain('["main.js", "manifest.json", "styles.css"]');
  // no one's own vault in the repository
  expect(deploy).not.toMatch(/base\/personal/);
  expect(read(".gitignore")).toContain(".deploy.json");
});

// ---------------------------------------------------------------- CSS

test("heading sizes are set on the line only, from the theme's heading variables", () => {
  for (let n = 1; n <= 6; n++) {
    expect(style(`.org-flex-view .cm-line.cm-org-level-${n}`, "font-size")).toBe(`var(--h${n}-size)`);
    expect(style(`.org-flex-view .org-heading-${n}`, "font-size")).toBeUndefined();
    expect(style(`.org-flex-view .org-heading-${n}`, "color")).toBe(`var(--h${n}-color)`);
  }
});

test("fold arrows hang in the line's left padding, hidden unless shown, with a tall tap target", () => {
  const arrow = ".org-flex-view .org-fold-toggle";
  expect(style(arrow, "position")).toBe("absolute");
  expect(style(arrow, "margin-left")).toBe("-22px");
  expect(style(".org-flex-view .cm-line", "padding")).toBe("0 var(--size-4-2) 0 24px");
  expect(style(arrow, "opacity")).toBe("0");
  expect(style(`${arrow}.is-shown`, "opacity")).toBe("1");
  expect(style(`${arrow}::before`, "top")).toBe("-8px");
  expect(style(`${arrow}::before`, "bottom")).toBe("-8px");
  expect(style(arrow, "user-select")).toBe("none");
});

test("bar buttons are full-size touch targets with no gaps between them", () => {
  expect(style(".org-flex-view .org-shortcut-bar", "gap")).toBe("0");
  expect(parseInt(style(".is-mobile .org-flex-view .org-shortcut-button", "min-width")!)).toBeGreaterThanOrEqual(48);
  expect(parseInt(style(".is-mobile .org-flex-view .org-shortcut-button", "height")!)).toBeGreaterThanOrEqual(44);
  expect(style(".org-flex-view .org-shortcut-button:active", "background-color")).toBeTruthy();
});

test("the shortcut bar is one row that scrolls sideways", () => {
  expect(style(".org-flex-view .org-shortcut-bar", "flex-wrap")).toBe("nowrap");
  expect(style(".org-flex-view .org-shortcut-bar", "overflow-x")).toBe("auto");
  expect(style(".org-flex-view .org-shortcut-button", "flex")).toBe("0 0 auto");
  expect(style(".is-phone.is-floating-nav .org-flex-view .cm-panels-bottom", "margin-bottom")).toContain("--view-bottom-spacing");
  // no gap above the keyboard
  for (const nav of ["", ".auto-full-screen", ".is-floating-nav"]) {
    expect(style(`.is-phone${nav} .org-flex-view.org-keyboard-open .cm-panels-bottom`, "margin-bottom")).toBe("0");
  }
});

test("flex children with siblings never use height: 100%", () => {
  for (const sel of [CONTENT, ".org-flex-view .cm-editor", ".org-flex-view .cm-scroller"]) {
    expect(style(sel, "flex"), sel).toBe("1 1 0%");
    expect(style(sel, "min-height"), sel).toBe("0");
    expect(style(sel, "height") ?? "auto", sel).toBe("auto");
  }
});

test("the header and content are sticky, and the phone's floating-header spacing is off", () => {
  for (const sel of [CONTENT, HEADER]) {
    expect(style(sel, "position"), sel).toBe("sticky");
    expect(style(sel, "top"), sel).toBe("0");
  }
  expect(style('.is-phone .mod-root .workspace-leaf-content[data-type="org-flex"]', "--view-top-spacing")).toBe("0");
});

test("on mobile the editor's scroller is the one scrolling element", () => {
  const sel = ".is-mobile .org-flex-view .cm-scroller";
  expect(style(sel, "overflow-y")).toBe("scroll");
  expect(style(sel, "-webkit-overflow-scrolling")).toBe("touch");
  expect(style(sel, "overscroll-behavior-y")).toBe("contain");
  expect(style(sel, "touch-action")).toBe("pan-y");
});

test("the view header and its title are forced visible", () => {
  expect(style(HEADER, "visibility")).toBe("visible");
  expect(style(HEADER, "opacity")).toBe("1");
  expect(style(HEADER, "display")).toBe("flex");
  expect(style(`${HEADER} .view-header-title`, "opacity")).toBe("1");
});

test("every style is scoped to the org view or the plugin's own classes", () => {
  expect(css.length).toBeGreaterThan(50);
  for (const rule of css) {
    for (const sel of rule.selectors) {
      expect(/\.org-[\w-]+|data-type="org-flex"/.test(sel), sel).toBe(true);
      if (/\.cm-|\.view-|\.workspace|\.markdown/.test(sel)) {
        expect(/\.org-flex-view|data-type="org-flex"/.test(sel), sel).toBe(true);
      }
    }
  }
});

// ---------------------------------------------------------------- PLAT-8 features

const featureFiles = readdirSync(join(__dirname, "..", "src/features"))
  .filter((f) => f.endsWith(".ts") && f !== "feature.ts" && f !== "index.ts");

function featureInfo(file: string) {
  const text = read(`src/features/${file}`);
  const m = /export const (\w+): Feature = \{\s*id: "([^"]+)",\s*section: "([^"]+)"/.exec(text);
  const buttons = /buttons: \{([\s\S]*?)\n  \}/.exec(text)?.[1] ?? /buttons: \{([^}]*)\}/.exec(text)?.[1] ?? "";
  return {
    name: m?.[1], id: m?.[2], section: m?.[3],
    buttons: Array.from(buttons.matchAll(/^\s*"?([a-z-]+)"?:\s*\(/gm), (b) => b[1]),
  };
}

test("each feature is one file, listed once, and owns a section of the spec that names it", () => {
  const index = read("src/features/index.ts");
  const spec = read("SPEC.md");
  const listed = /FEATURES: Feature\[\] = \[([^\]]*)\]/.exec(index)![1].split(",").map((s) => s.trim()).filter(Boolean);
  expect(featureFiles.length).toBe(listed.length);
  for (const file of featureFiles) {
    const f = featureInfo(file);
    expect(f.id, file).toBe(file.replace(/\.ts$/, ""));
    expect(listed, file).toContain(f.name);
    const start = spec.indexOf(`\n## ${f.section}\n`);
    expect(start, `${file}: ## ${f.section}`).toBeGreaterThan(0);
    const end = spec.indexOf("\n## ", start + 4);
    expect(spec.slice(start, end), file).toContain(`src/features/${file}`);
  }
});

test("only the feature list reaches into a feature, so dropping one stays local", () => {
  for (const file of sources()) {
    if (file.startsWith("src/features/")) continue;
    for (const m of read(file).matchAll(/from "([^"]*features[^"]*)"/g)) expect(m[1], file).toMatch(/\/features$/);
  }
});

test("every bar button is run by the core or by exactly one feature", () => {
  const ids = Array.from(read("src/settings.ts").matchAll(/\{ id: "([a-z-]+)", name:/g), (m) => m[1]);
  const core = /CORE_BUTTONS[^[]*\[([^\]]*)\]/.exec(read("src/settings.ts"))![1].match(/[a-z-]+/g)!;
  const owned = featureFiles.flatMap((f) => featureInfo(f).buttons);
  for (const id of ids) expect([...core, ...owned].filter((x) => x === id).length, id).toBe(1);
  expect(owned.filter((id) => !ids.includes(id))).toEqual([]);
});
