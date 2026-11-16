// Where Brakeline keeps its state.
// From a git checkout: ./data next to the code. Installed from npm (npx / global): ~/.brakeline, so rules,
// journal and logins survive updates. BRAKELINE_HOME overrides both.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const installed = pkgDir.split(/[\\/]/).some((part) => part === "node_modules" || part === "_npx");
export const DATA_DIR = process.env.BRAKELINE_HOME || (installed ? join(homedir(), ".brakeline") : join(pkgDir, "data"));

mkdirSync(DATA_DIR, { recursive: true });
const defaults = join(pkgDir, "data", "rules.json");
if (!existsSync(join(DATA_DIR, "rules.json")) && existsSync(defaults)) copyFileSync(defaults, join(DATA_DIR, "rules.json"));

export const dataFile = (name) => join(DATA_DIR, name);
