/**
 * The properties this has to hold are the ones that decide whether an owner
 * gets their vault back if it goes wrong: nothing is deleted, nothing existing
 * is overwritten, a dirty worktree is refused, and running twice is a no-op.
 *
 * The runner is driven with `spawnSync` rather than imported — it runs its
 * `main()` at module scope, and half of what is being checked here is the exit
 * code and the refusal text.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import migration from "./migrations/001-profile-to-memory.mjs";
import { MARKER, alreadyMigrated, deriveNotes } from "./migrations/lib/decision-log.mjs";

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "vault-upgrade.mjs");

const LOG = `# Decision log

## Decisions

- 2026-01-05 T-0001 Ship the thing: do not wait for the redesign
  (from: should we hold the release?)
- 2026-02-11 Prefer append over rewrite
- 2026-03-02 T-0009 Prefer append over rewrite
`;

let vault;

function write(rel, text) {
  const path = join(vault, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

function git(...args) {
  return execFileSync("git", ["-C", vault, ...args], { encoding: "utf8" });
}

function run(...args) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: "utf8",
    env: { ...process.env, WORKHUB_VAULT: vault },
  });
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-upgrade-"));
  mkdirSync(join(vault, "tasks"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
  write("profile/about-me.md", "# About me\n\nThe owner.\n");
  write("profile/decision-policy.md", "# Policy\n\n## Preferences\n");
  write("profile/strategist.md", "---\npersona: noctis\n---\n");
  write("profile/decision-log.md", LOG);
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-qm", "seed");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("deriveNotes", () => {
  it("turns each logged call into a typed note carrying the marker", () => {
    const notes = deriveNotes(vault);
    expect(notes).toHaveLength(3);
    const first = notes[0].content;
    expect(first).toContain("type: decision");
    expect(first).toContain("status: accepted");
    expect(first).toContain("decided: 2026-01-05");
    expect(first).toContain("task: T-0001");
    expect(first).toContain(MARKER);
    expect(first).toContain("- [decision] Ship the thing: do not wait for the redesign");
    expect(first).toContain("- [context] should we hold the release?");
  });

  it("quotes the title, because a rule is prose and may hold a colon", () => {
    // An unquoted `title: Ship the thing: do not wait` is a YAML parse error,
    // and the note silently loses its frontmatter.
    expect(deriveNotes(vault)[0].content).toContain(
      'title: "Ship the thing: do not wait for the redesign"',
    );
  });

  it("keeps two calls that read the same, rather than one overwriting the other", () => {
    const paths = deriveNotes(vault).map((n) => n.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.some((p) => p.includes("2026-03-02"))).toBe(true);
  });

  it("reports nothing to do once a generated note is in place", () => {
    expect(alreadyMigrated(vault)).toBe(false);
    write("memory/notes/x.md", `---\n${MARKER}\n---\n`);
    expect(alreadyMigrated(vault)).toBe(true);
  });
});

describe("detect", () => {
  it("asks to run while the identity notes are still in the old folder", () => {
    const { needed, reason } = migration.detect(vault);
    expect(needed).toBe(true);
    expect(reason).toContain("identity note");
  });

  it("says a vault with no profile/ folder is already current", () => {
    rmSync(join(vault, "profile"), { recursive: true });
    const { needed, reason } = migration.detect(vault);
    expect(needed).toBe(false);
    expect(reason).toContain("already on the memory/ layout");
  });
});

describe("plan", () => {
  it("changes nothing on disk", () => {
    const before = readFileSync(join(vault, "profile/about-me.md"), "utf8");
    expect(run("plan", "001").status).toBe(0);
    expect(existsSync(join(vault, "memory"))).toBe(false);
    expect(readFileSync(join(vault, "profile/about-me.md"), "utf8")).toBe(before);
  });

  it("names what it will not delete", () => {
    expect(run("plan", "001").stdout).toContain("NOT deleted");
  });
});

describe("apply", () => {
  it("moves the identity notes and derives the decision notes", () => {
    const { status, stdout } = run("apply", "001");
    expect(stdout).toContain("applied");
    expect(status).toBe(0);

    for (const name of ["about-me.md", "decision-policy.md", "strategist.md"]) {
      expect(existsSync(join(vault, "memory/identity", name)), name).toBe(true);
      expect(existsSync(join(vault, "profile", name)), name).toBe(false);
    }
    expect(readFileSync(join(vault, "memory/identity/about-me.md"), "utf8")).toContain(
      "The owner.",
    );
  });

  it("leaves the decision log where it was", () => {
    // The notes have to be read and committed before the file they came from
    // goes anywhere, and that is the owner's call, not this script's.
    run("apply", "001");
    expect(existsSync(join(vault, "profile/decision-log.md"))).toBe(true);
  });

  it("is a no-op the second time", () => {
    run("apply", "001");
    const second = run("apply", "001");
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("nothing to do");
  });

  it("moves an occupying file aside instead of overwriting it", () => {
    // A template seed and the owner's own writing are indistinguishable — the
    // seeded paths carry no manifest baseline — so neither one is ever lost.
    write("memory/identity/about-me.md", "seeded stub\n");
    git("add", "-A");
    git("commit", "-qm", "seed stub");

    const { stdout } = run("apply", "001");
    expect(stdout).toContain("moved aside");
    expect(readFileSync(join(vault, "memory/identity/about-me.template.md"), "utf8")).toBe(
      "seeded stub\n",
    );
    expect(readFileSync(join(vault, "memory/identity/about-me.md"), "utf8")).toContain(
      "The owner.",
    );
  });

  it("refuses a vault with uncommitted changes", () => {
    write("profile/about-me.md", "edited\n");
    const { status, stderr } = run("apply", "001");
    expect(status).toBe(1);
    expect(stderr).toContain("uncommitted changes");
    expect(existsSync(join(vault, "memory"))).toBe(false);
  });
});

describe("status", () => {
  it("reports a current vault as needing nothing", () => {
    run("apply", "001");
    const { stdout } = run("status");
    expect(stdout).toContain("layout is current");
  });
});
