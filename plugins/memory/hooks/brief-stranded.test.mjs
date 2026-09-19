/**
 * T-0392: the SessionStart brief must tell the session when memory is
 * stranded under the pre-T-0390 `_ai/memory/` folder, and must not open (or
 * create) `_ai/state/memory.db` while it is.
 *
 * Run as a spawned process, like `capture.test.mjs`: the hook is a script
 * that dynamically imports the engine, not a module built for in-process
 * import.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./../engine/lib/paths.mjs";

const briefPath = join(dirname(fileURLToPath(import.meta.url)), "brief.mjs");

let vault;
let engineHome;

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "workhub-brief-stranded-vault-"));
  engineHome = mkdtempSync(join(os.tmpdir(), "workhub-brief-stranded-home-"));
  writeFileSync(
    join(engineHome, ".setup-version"),
    JSON.stringify({ version: ENGINE_VERSION, installedAt: new Date().toISOString(), model: "test" }),
  );
  mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
  writeFileSync(join(vault, "_ai", "memory", "memory.db"), "sqlite");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(engineHome, { recursive: true, force: true });
});

function runBrief() {
  return spawnSync(process.execPath, [briefPath], {
    input: JSON.stringify({}),
    encoding: "utf8",
    env: { ...process.env, WORKHUB_VAULT: vault, WORKHUB_ENGINE_HOME: engineHome },
  });
}

describe("brief hook on a stranded vault", () => {
  it("prints the stranded notice without creating _ai/state/memory.db", () => {
    const result = runBrief();
    expect(result.stdout).toMatch(/_ai\/memory/);
    expect(result.stdout).toMatch(/vault-upgrade|migration 002/);
    expect(existsSync(join(vault, "_ai", "state", "memory.db"))).toBe(false);
  });
});
