/**
 * Migration 002: `_ai/memory/` → `_ai/state/`.
 *
 * T-0390 renamed `_ai/memory/` to `_ai/state/` with a transitional fallback
 * so an unmigrated vault kept working; T-0392 removed that fallback, so a
 * vault that has not run this migration now has its memory, session task
 * markers and tidy pending list stranded under `_ai/memory/`. What matters
 * here is that it moves everything, is safe to run when `_ai/state/` already
 * holds files (merge, or refuse a real collision — never clobber), and
 * reports itself done once nothing is left.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import migration from "./002-ai-memory-to-state.mjs";

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "..", "vault-upgrade.mjs");

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
  vault = mkdtempSync(join(tmpdir(), "vault-upgrade-ai-state-"));
  mkdirSync(join(vault, "tasks"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("detect", () => {
  it("says a vault with no _ai/memory/ folder is already current", () => {
    const { needed, reason } = migration.detect(vault);
    expect(needed).toBe(false);
    expect(reason).toContain("already on the _ai/state/ layout");
  });

  it("says an empty _ai/memory/ (template placeholder only) has nothing to move", () => {
    write("_ai/memory/.gitkeep", "");
    const { needed, reason } = migration.detect(vault);
    expect(needed).toBe(false);
    expect(reason).toContain("nothing left to move");
  });

  it("asks to run while files are still under _ai/memory/", () => {
    write("_ai/memory/sessions/default.json", '{"id":"T-0001"}');
    write("_ai/memory/tidy-pending.json", '{"files":[]}');
    const { needed, reason, steps } = migration.detect(vault);
    expect(needed).toBe(true);
    expect(reason).toContain("2 file(s)");
    // One mkdir plus one move per file.
    expect(steps.filter((s) => s.kind === "move")).toHaveLength(2);
  });
});

describe("apply (via the runner)", () => {
  beforeEach(() => {
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
  });

  it("moves every file into _ai/state/ and preserves its content", () => {
    write("_ai/memory/sessions/default.json", '{"id":"T-0001"}');
    git("add", "-A");
    git("commit", "-qm", "seed");

    const { status, stdout } = run("apply", "002");
    expect(status).toBe(0);
    expect(stdout).toContain("applied");
    expect(existsSync(join(vault, "_ai", "memory", "sessions", "default.json"))).toBe(false);
    expect(readFileSync(join(vault, "_ai", "state", "sessions", "default.json"), "utf8")).toBe(
      '{"id":"T-0001"}',
    );
  });

  it("moves a gitignored file too, which git mv would refuse", () => {
    // The real vault's `memory.db` is gitignored; `git mv` failed on it with
    // "not under version control" and aborted the run.
    write(".gitignore", "_ai/memory/memory.db\n");
    write("_ai/memory/memory.db", "sqlite");
    write("_ai/memory/sessions/default.json", '{"id":"T-0001"}');
    git("add", "-A");
    git("commit", "-qm", "seed");

    const { status, stderr } = run("apply", "002");
    expect(stderr).not.toContain("not under version control");
    expect(status).toBe(0);
    expect(existsSync(join(vault, "_ai", "memory", "memory.db"))).toBe(false);
    expect(readFileSync(join(vault, "_ai", "state", "memory.db"), "utf8")).toBe("sqlite");
    expect(existsSync(join(vault, "_ai", "state", "sessions", "default.json"))).toBe(true);
  });

  it("is a no-op the second time", () => {
    write("_ai/memory/tidy-pending.json", '{"files":[]}');
    git("add", "-A");
    git("commit", "-qm", "seed");

    run("apply", "002");
    const second = run("apply", "002");
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("nothing to do");
  });

  it("merges into an _ai/state/ that already exists rather than clobbering it", () => {
    write("_ai/memory/tidy-pending.json", '{"files":[]}');
    write("_ai/state/sessions/default.json", '{"id":"T-0002"}');
    git("add", "-A");
    git("commit", "-qm", "seed");

    const { status } = run("apply", "002");
    expect(status).toBe(0);
    // The pre-existing file is untouched, and the moved-in file sits beside it.
    expect(readFileSync(join(vault, "_ai", "state", "sessions", "default.json"), "utf8")).toBe(
      '{"id":"T-0002"}',
    );
    expect(existsSync(join(vault, "_ai", "state", "tidy-pending.json"))).toBe(true);
  });

  it("refuses when the same file holds different real content on both sides", () => {
    write("_ai/memory/tidy-pending.json", '{"files":["a"]}');
    write("_ai/state/tidy-pending.json", '{"files":["b"]}');
    git("add", "-A");
    git("commit", "-qm", "seed");

    const { status, stderr } = run("apply", "002");
    expect(status).not.toBe(0);
    expect(stderr).toContain("no telling which one is yours");
    // Neither side was touched by the aborted run.
    expect(readFileSync(join(vault, "_ai", "memory", "tidy-pending.json"), "utf8")).toBe(
      '{"files":["a"]}',
    );
    expect(readFileSync(join(vault, "_ai", "state", "tidy-pending.json"), "utf8")).toBe(
      '{"files":["b"]}',
    );
  });
});
