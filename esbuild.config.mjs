import esbuild from "esbuild";

const production = process.argv[2] === "production";

// Everything except Obsidian itself is bundled, CodeMirror included: the
// editor is the plugin's own CodeMirror instance (PLAT-4), so it never
// depends on the versions Obsidian happens to ship.
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: "main.js",
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
