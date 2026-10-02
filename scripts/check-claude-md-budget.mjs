// Fails when `vault-template/CLAUDE.md` outgrows its always-loaded budget.
//
// That file is loaded into every session of every vault, so each line costs
// every turn. It reached 859 lines by one section at a time — a schedule
// format here, a worktree recipe there — each reasonable alone, and nothing
// stopped the sum (T-0542 cut it back to about 200). A rule in prose did not
// stop it either, so this is the check that does.
//
// What a section needs to be in that file is stated in
// `.claude/rules/vault-template-claude-md.md`.
//
// Usage: node scripts/check-claude-md-budget.mjs [path]

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/** Lines the template's CLAUDE.md may hold. T-0542 left it at about 220. */
export const MAX_LINES = 250;

const DEFAULT_PATH = "vault-template/CLAUDE.md";

/** Number of lines in `text`, not counting the final newline. */
export function countLines(text) {
  if (text === "") return 0;
  const n = text.split(/\r?\n/).length;
  return text.endsWith("\n") ? n - 1 : n;
}

/** The failure message for `lines`, or `null` when within budget. */
export function overBudget(lines, max = MAX_LINES) {
  if (lines <= max) return null;
  return (
    `vault-template/CLAUDE.md is ${lines} lines; the budget is ${max}.\n` +
    "It loads in every session, so move what only some work needs into a\n" +
    "`.claude/rules/<name>.md` with `paths:` (or into a skill), and leave a\n" +
    "pointer here. See .claude/rules/vault-template-claude-md.md."
  );
}

function main() {
  const path = argv[2] ?? DEFAULT_PATH;
  const lines = countLines(readFileSync(path, "utf8"));
  const message = overBudget(lines);
  if (message) {
    console.error(message);
    exit(1);
  }
  console.log(`${path}: ${lines} lines (budget ${MAX_LINES})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
