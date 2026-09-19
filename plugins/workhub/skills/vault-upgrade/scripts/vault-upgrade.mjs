#!/usr/bin/env node
/**
 * vault-upgrade — bring a vault's layout up to what the current workhub ships.
 *
 * A structural change to the vault breaks existing vaults *silently*: a hook
 * gates on a path that no longer exists, exits 0, and nothing says so. T-0374
 * moved `profile/` to `memory/identity/`, and the only symptom on a vault that
 * had not moved with it was that the owner's context quietly stopped arriving.
 * This is the one place those changes are carried forward.
 *
 * One migration is one module under `migrations/`. A migration only *describes*
 * what it wants done; the runner is what does it. That split is the point —
 * the invariants below hold for every migration ever written, and a migration
 * that had to remember them is a migration that would eventually forget one:
 *
 *   - **Nothing is deleted.** Every step is a move, a mkdir or a write.
 *     Removing a source file is always a separate, later decision by the owner.
 *   - **Nothing existing is overwritten, and a collision is never guessed.**
 *     The one thing decidable about two colliding files is whether either is
 *     byte-for-byte something the template shipped (`lib/seeds.mjs`). A
 *     boilerplate source is left where it is; a boilerplate destination is
 *     moved aside to `<name>.template.<ext>`; two files that are both real
 *     writing stop the run. Guessing a direction is how T-0380 nearly put the
 *     template's placeholder where the owner's note was.
 *   - **A dirty git worktree stops everything**, which keeps the whole run one
 *     `git checkout` away from undone.
 *   - **`apply` is idempotent**, because `detect` answers false once the shape
 *     it looks for is gone. Running twice is a no-op, not a mess.
 *
 * Usage, from anywhere inside the vault:
 *
 *   node vault-upgrade.mjs status
 *   node vault-upgrade.mjs plan  <id>
 *   node vault-upgrade.mjs apply <id>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveVault } from "../../../hooks/lib.mjs";
import profileToMemory from "./migrations/001-profile-to-memory.mjs";
import aiMemoryToState from "./migrations/002-ai-memory-to-state.mjs";
import { fingerprint, isTemplate } from "./migrations/lib/seeds.mjs";

/** Every migration, oldest first. Order is the order they are applied in. */
const MIGRATIONS = [profileToMemory, aiMemoryToState];

const HERE = dirname(fileURLToPath(import.meta.url));

// --- git ------------------------------------------------------------------

function git(vault, args) {
  return execFileSync("git", ["-C", vault, ...args], { encoding: "utf8" }).trim();
}

function isGitRepo(vault) {
  try {
    return git(vault, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
}

/**
 * Refuse to touch a vault with uncommitted work.
 *
 * Not fussiness: this is what makes the run reversible. A vault whose only
 * changes are the ones this made can be undone with one command; a vault that
 * was already half-edited cannot, and the owner finds that out afterwards.
 */
function dirtyFiles(vault) {
  if (!isGitRepo(vault)) return [];
  return git(vault, ["status", "--porcelain"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// --- step execution -------------------------------------------------------

/** `memory/identity/about-me.md` → `memory/identity/about-me.template.md` */
function divertedName(path) {
  const ext = extname(path);
  return `${path.slice(0, path.length - ext.length)}.template${ext}`;
}

/** Is `path` tracked by git? An untracked or gitignored file is not. */
function isTracked(vault, path) {
  try {
    git(vault, ["ls-files", "--error-unmatch", "--", relative(vault, path)]);
    return true;
  } catch {
    return false;
  }
}

function move(vault, from, to, useGit) {
  mkdirSync(dirname(to), { recursive: true });
  // `git mv` refuses a file git does not track — the memory engine's
  // gitignored `memory.db` is one (T-0390). Such a file is moved on disk; git
  // has nothing to record for it either way.
  if (useGit && isTracked(vault, from)) {
    git(vault, ["mv", relative(vault, from), relative(vault, to)]);
  } else {
    renameSync(from, to);
  }
}

/**
 * Execute one step. Returns the line to report, or throws when an invariant
 * would be broken — a throw aborts the run, because a migration that is half
 * applied is worse than one that never started.
 */
function runStep(vault, step, { dryRun, useGit, report }) {
  const rel = (p) => relative(vault, p).replaceAll("\\", "/");

  if (step.kind === "mkdir") {
    if (existsSync(step.path)) return;
    if (!dryRun) mkdirSync(step.path, { recursive: true });
    report.created.push(`${rel(step.path)}/`);
    return;
  }

  if (step.kind === "write") {
    if (existsSync(step.path)) {
      // Not an error: a re-run, or a file the owner already wrote. Either way
      // theirs wins and we say we left it alone.
      report.kept.push(`${rel(step.path)} (already present, left as is)`);
      return;
    }
    if (!dryRun) {
      mkdirSync(dirname(step.path), { recursive: true });
      writeFileSync(step.path, step.content, "utf8");
    }
    report.written.push(rel(step.path));
    return;
  }

  if (step.kind === "move") {
    if (!existsSync(step.from)) {
      report.kept.push(`${rel(step.from)} (not there — nothing to move)`);
      return;
    }
    if (existsSync(step.to)) {
      // Both ends exist. Which one is the owner's cannot be guessed — T-0380
      // guessed "the destination is the seed", met the reverse, and would have
      // put template boilerplate where the owner's note was. What *can* be
      // decided is whether either side is exactly something the template
      // shipped; everything else stops and asks.
      if (fingerprint(step.from) === fingerprint(step.to)) {
        report.kept.push(`${rel(step.from)} (identical to ${rel(step.to)} — nothing to move)`);
        report.left.push(`${rel(step.from)} — a duplicate of ${rel(step.to)}; safe to delete`);
        return;
      }
      if (isTemplate(step.from, step.seeds)) {
        report.kept.push(`${rel(step.from)} (template boilerplate, not your writing)`);
        report.left.push(
          `${rel(step.from)} — the template's placeholder, put back by an older app; safe to delete`,
        );
        return;
      }
      if (!isTemplate(step.to, step.seeds)) {
        throw new Error(
          `${rel(step.from)} and ${rel(step.to)} both hold writing that is not ` +
            `template boilerplate, so there is no telling which one is yours. ` +
            `Compare them, keep the one you want at ${rel(step.to)}, and re-run.`,
        );
      }
      const aside = divertedName(step.to);
      if (existsSync(aside)) {
        throw new Error(
          `${rel(step.to)} is occupied and ${rel(aside)} already exists — ` +
            `move one of them out of the way by hand and re-run`,
        );
      }
      if (!dryRun) move(vault, step.to, aside, useGit);
      report.diverted.push(`${rel(step.to)} → ${rel(aside)} (the template's placeholder)`);
    }
    if (!dryRun) move(vault, step.from, step.to, useGit);
    report.moved.push(`${rel(step.from)} → ${rel(step.to)}`);
    return;
  }

  throw new Error(`unknown step kind: ${step.kind}`);
}

function emptyReport() {
  return { moved: [], written: [], created: [], diverted: [], kept: [], left: [] };
}

function printReport(report, { dryRun }) {
  const section = (title, lines) => {
    if (!lines.length) return;
    console.log(`\n${title}`);
    for (const line of lines) console.log(`  ${line}`);
  };
  const verb = dryRun ? "would be " : "";
  section(`${verb}moved`, report.moved);
  section(`${verb}written`, report.written);
  section(`${verb}created`, report.created);
  section(`${verb}moved aside`, report.diverted);
  section("left alone", report.kept);
  section("NOT deleted — yours to remove once you are happy", report.left);
}

// --- commands -------------------------------------------------------------

function find(id) {
  const migration = MIGRATIONS.find((m) => m.id === id);
  if (!migration) {
    console.error(`no migration ${id}. Known: ${MIGRATIONS.map((m) => m.id).join(", ")}`);
    process.exit(1);
  }
  return migration;
}

function status(vault) {
  console.log(`vault: ${vault}\n`);
  let pending = 0;
  for (const migration of MIGRATIONS) {
    const result = migration.detect(vault);
    if (result.needed) pending += 1;
    console.log(`${result.needed ? "NEEDED" : "done  "}  ${migration.id}  ${migration.title}`);
    console.log(`        since ${migration.since} — ${result.reason}`);
  }
  console.log(
    pending
      ? `\n${pending} migration(s) to run. \`plan <id>\` shows exactly what each one touches.`
      : "\nthis vault's layout is current.",
  );
}

function plan(vault, id) {
  const migration = find(id);
  const result = migration.detect(vault);
  console.log(`${migration.id}  ${migration.title}\n`);
  console.log(`${migration.why}\n`);
  if (!result.needed) {
    console.log(`nothing to do — ${result.reason}`);
    return;
  }
  const report = emptyReport();
  for (const step of result.steps) runStep(vault, step, { dryRun: true, useGit: false, report });
  report.left.push(...(result.left ?? []));
  printReport(report, { dryRun: true });
  console.log(`\nnothing above is deleted. Run \`apply ${migration.id}\` once the owner agrees.`);
}

function apply(vault, id) {
  const migration = find(id);
  const result = migration.detect(vault);
  if (!result.needed) {
    console.log(`${migration.id}: nothing to do — ${result.reason}`);
    return;
  }

  const dirty = dirtyFiles(vault);
  if (dirty.length) {
    console.error(
      `the vault has uncommitted changes, so this run could not be undone cleanly:\n` +
        dirty.map((l) => `  ${l}`).join("\n") +
        `\n\ncommit or discard them first, then re-run.`,
    );
    process.exit(1);
  }

  const useGit = isGitRepo(vault);
  const report = emptyReport();
  for (const step of result.steps) runStep(vault, step, { dryRun: false, useGit, report });
  report.left.push(...(result.left ?? []));

  console.log(`${migration.id}  ${migration.title} — applied`);
  printReport(report, { dryRun: false });

  const after = migration.detect(vault);
  if (after.needed) {
    console.error(
      `\nthis migration still reports itself as needed after running, which means ` +
        `it is not finished. Read the report above before doing anything else.`,
    );
    process.exit(1);
  }
  if (migration.verify) {
    console.log("\nverify");
    for (const line of migration.verify(vault)) console.log(`  ${line}`);
  }
  if (useGit) {
    console.log(`\nreview with \`git -C "${vault}" status\`, undo with \`git -C "${vault}" checkout -- .\`.`);
  }
}

// --- entry ----------------------------------------------------------------

function main() {
  const [command, id] = process.argv.slice(2);
  const vault = process.env.WORKHUB_VAULT || resolveVault();
  if (!vault || !existsSync(join(vault, "tasks"))) {
    console.error(
      "no workhub vault here. Run this from inside the vault, or set WORKHUB_VAULT.",
    );
    process.exit(1);
  }
  const root = resolve(vault);

  if (command === "status" || !command) return status(root);
  if (command === "plan") return plan(root, id);
  if (command === "apply") return apply(root, id);

  console.error(`usage: node ${relative(process.cwd(), HERE)}/vault-upgrade.mjs status|plan <id>|apply <id>`);
  process.exit(1);
}

main();
