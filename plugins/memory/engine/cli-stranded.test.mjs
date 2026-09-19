/**
 * T-0392 removed the transitional `_ai/memory/` → `_ai/state/` fallback:
 * every DB-opening CLI command must now detect a stranded legacy database
 * and no-op instead of silently starting a second, empty one at
 * `_ai/state/memory.db`.
 *
 * Run as a spawned process (matching the pattern in `capture.test.mjs`):
 * `cli.mjs` is a script, not a module built for in-process import, and this
 * exercises it exactly as the OpenCode plugin and a plain terminal do.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");

let vault;
let engineHome;

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "workhub-cli-stranded-vault-"));
  engineHome = mkdtempSync(join(os.tmpdir(), "workhub-cli-stranded-home-"));
  // A stranded vault: real data under the legacy folder, nothing at the new
  // path.
  mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
  writeFileSync(join(vault, "_ai", "memory", "memory.db"), "sqlite");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(engineHome, { recursive: true, force: true });
});

function run(args, { input = "" } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, WORKHUB_VAULT: vault, WORKHUB_ENGINE_HOME: engineHome },
  });
}

describe("inject on a stranded vault", () => {
  it("prepends the stranded notice on the session's first prompt", () => {
    const result = run(["inject"], {
      input: JSON.stringify({ prompt: "hello", session_id: "s1" }),
    });
    expect(result.stdout).toMatch(/_ai\/memory/);
    expect(result.stdout).toMatch(/migration 002|vault-upgrade/);
    expect(existsSync(join(vault, "_ai", "state", "memory.db"))).toBe(false);
  });

  it("says nothing on a later prompt of the same session", () => {
    run(["inject"], { input: JSON.stringify({ prompt: "hello", session_id: "s1" }) });
    const second = run(["inject"], {
      input: JSON.stringify({ prompt: "again", session_id: "s1" }),
    });
    expect(second.stdout.trim()).toBe("");
    expect(existsSync(join(vault, "_ai", "state", "memory.db"))).toBe(false);
  });
});

describe("capture-json on a stranded vault", () => {
  it("no-ops instead of creating a fresh database", () => {
    const result = run(["capture-json"], {
      input: JSON.stringify({ session_id: "s1", project: "", messages: [] }),
    });
    expect(existsSync(join(vault, "_ai", "state", "memory.db"))).toBe(false);
    expect(result.stderr).toMatch(/_ai\/memory/);
  });
});

describe("status on a stranded vault", () => {
  it("reports stranded instead of opening a database", () => {
    const result = run(["status"]);
    expect(result.stdout).toMatch(/stranded/);
    expect(existsSync(join(vault, "_ai", "state", "memory.db"))).toBe(false);
  });
});
