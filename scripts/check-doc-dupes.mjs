// Guards against the duplicate-doc drift bug: the same Markdown document living
// in both the committed `docs/` tree and the git-ignored `context/` tree, where
// the ignored copy silently rots out of sync (invisible to `git status`).
//
// Rule: every `.md` document has exactly ONE home.
//   - docs/     = canonical, committed project documentation
//   - context/  = local-only throwaway scratch: research prompts, screenshots,
//                 starter template (git-ignored)
// No `.md` basename may appear in BOTH trees.
//
// Run: `npm run docs:check`  (exits non-zero on a collision)

import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

// The self-contained starter template under context/ intentionally mirrors a
// fresh project's layout (its own context/, .claude/, README, etc.) — those are
// not "the same document" as this repo's docs, so exclude that subtree.
const EXCLUDED_DIRS = new Set(["node_modules", ".git"]);
const EXCLUDED_CONTEXT_SUBPATH = join("context", "new project setup");

/** Recursively collect every `.md` file path under `dir`. */
function collectMarkdown(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // dir doesn't exist — nothing to collect
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (EXCLUDED_DIRS.has(entry)) continue;
    if (full.includes(EXCLUDED_CONTEXT_SUBPATH)) continue;
    if (statSync(full).isDirectory()) collectMarkdown(full, out);
    else if (entry.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

function basenameMap(paths) {
  const map = new Map(); // basename -> [paths]
  for (const p of paths) {
    const key = basename(p).toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return map;
}

const docs = basenameMap(collectMarkdown("docs"));
const context = basenameMap(collectMarkdown("context"));

const collisions = [];
for (const [name, docPaths] of docs) {
  if (context.has(name)) {
    collisions.push({ name, docPaths, contextPaths: context.get(name) });
  }
}

if (collisions.length === 0) {
  console.log("docs:check ✓ — no document exists in both docs/ and context/");
  process.exit(0);
}

console.error(
  `docs:check ✗ — ${collisions.length} document(s) exist in BOTH docs/ and context/.\n` +
    `Each doc must have one home: keep the docs/ copy (committed) and delete the context/ one.\n`
);
for (const { name, docPaths, contextPaths } of collisions) {
  console.error(`  • ${name}`);
  for (const p of docPaths) console.error(`      docs:    ${p}`);
  for (const p of contextPaths) console.error(`      context: ${p}`);
}
process.exit(1);
