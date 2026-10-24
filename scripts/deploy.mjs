// Copy the build into a vault (PLAT-5). The vault comes from OBSIDIAN_VAULT,
// else from the git-ignored .deploy.json: {"vault": "~/my-vault", "specCopy":
// "attachments/org-flex-SPEC.md"}. specCopy, optional, is where in the vault
// a copy of SPEC.md goes.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const config = existsSync(".deploy.json") ? JSON.parse(readFileSync(".deploy.json", "utf8")) : {};
const home = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const vault = process.env.OBSIDIAN_VAULT || config.vault;
if (!vault) {
  console.error('No vault: set OBSIDIAN_VAULT or put {"vault": "<path>"} in .deploy.json.');
  process.exit(1);
}
const root = resolve(home(vault));
const plugin = join(root, ".obsidian", "plugins", "org-flex");
mkdirSync(plugin, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) copyFileSync(file, join(plugin, file));
console.log(`Copied main.js, manifest.json and styles.css to ${plugin}`);
const specCopy = process.env.ORG_FLEX_SPEC_COPY || config.specCopy;
if (specCopy) {
  const target = isAbsolute(home(specCopy)) ? home(specCopy) : join(root, specCopy);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync("SPEC.md", target);
  console.log(`Copied SPEC.md to ${target}`);
}
