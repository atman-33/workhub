// Fails when a plugin changed without its `version` changing.
//
// `.claude/rules/plugin-authoring.md` has required this since plugins existed,
// and it has been missed three times now (b8af4ec fixed two of them at once,
// e37c690 added `--backlog` to task-cli.mjs and skipped it again). The failure
// is silent in the worst way: a plugin cache is keyed by version, so a change
// that keeps the version never reaches an installed copy — the script on disk
// simply keeps behaving like the old one, and the only symptom is a command
// that mysteriously does nothing.
//
// A rule that only lives in prose is a rule that gets skipped, so this is the
// check that enforces it.
//
// Usage: node scripts/check-plugin-versions.mjs <base-ref>

import { execFileSync } from "node:child_process";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/** Plugin names touched by the diff, in the order they first appear. */
export function pluginsInDiff(files) {
  const seen = new Set();
  for (const file of files) {
    const m = /^plugins\/([^/]+)\//.exec(file.replaceAll("\\", "/"));
    if (m) seen.add(m[1]);
  }
  return [...seen].sort();
}

/** The `version` field of a plugin manifest, or null when it cannot be read. */
export function versionOf(json) {
  try {
    const v = JSON.parse(json).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function main(base) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf-8" });

  // A checkout that cannot see the base ref used to fail as a node stack
  // trace, which reads like a broken script rather than a broken checkout —
  // and so the step sat red on three PRs without anyone reading what it said.
  // Say it plainly instead.
  try {
    git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
  } catch {
    console.error(
      `cannot resolve base ref '${base}'.\n\n` +
        "The check diffs a branch against its base, so the base has to be in\n" +
        "the clone. In CI that means `fetch-depth: 0` on actions/checkout —\n" +
        "the default shallow clone fetches no other branch.\n",
    );
    return 1;
  }

  const files = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  const plugins = pluginsInDiff(files);

  if (plugins.length === 0) {
    console.log("no plugin changed");
    return 0;
  }

  const stale = [];
  for (const name of plugins) {
    const manifest = `plugins/${name}/.claude-plugin/plugin.json`;
    let before = null;
    try {
      before = versionOf(git("show", `${base}:${manifest}`));
    } catch {
      // New plugin: nothing to compare against, and its first version is fine.
      console.log(`${name}: new plugin`);
      continue;
    }
    const after = versionOf(git("show", `HEAD:${manifest}`));
    if (after === null) {
      stale.push(`${name}: ${manifest} is missing or has no version`);
    } else if (before === after) {
      stale.push(`${name}: changed but version is still ${after}`);
    } else {
      console.log(`${name}: ${before} -> ${after}`);
    }
  }

  if (stale.length === 0) return 0;

  console.error("\nplugin version not raised:\n");
  for (const line of stale) console.error(`  ${line}`);
  console.error(
    `
An installed plugin updates on its \`version\` alone, so a change that keeps the
version never reaches anyone — see .claude/rules/plugin-authoring.md. Bump the
version in each plugin listed above: breaking -> major, new capability -> minor,
wording or doc-only -> patch.
`,
  );
  return 1;
}

// Only run when invoked as a command; the tests import the helpers above.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const base = argv[2];
  if (!base) {
    console.error("usage: node scripts/check-plugin-versions.mjs <base-ref>");
    exit(2);
  }
  exit(main(base));
}
