/**
 * `dbPathForVault`'s T-0390 transitional resolver: `_ai/memory/` was renamed
 * to `_ai/state/` because the name collided with the unrelated `memory/`
 * knowledge layer. An installed engine copy predating the rename must still
 * find (and this new copy must still write to) whichever folder actually
 * exists on a vault that has not yet run `vault-upgrade`'s migration.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbPathForVault } from "./paths.mjs";

let vault;

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "workhub-dbpath-"));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("dbPathForVault", () => {
  it("prefers _ai/state/ when it exists", () => {
    mkdirSync(join(vault, "_ai", "state"), { recursive: true });
    mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
    expect(dbPathForVault(vault)).toBe(join(vault, "_ai", "state", "memory.db"));
  });

  it("falls back to the legacy _ai/memory/ folder", () => {
    mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
    expect(dbPathForVault(vault)).toBe(join(vault, "_ai", "memory", "memory.db"));
  });

  it("defaults to _ai/state/ when neither folder exists", () => {
    expect(dbPathForVault(vault)).toBe(join(vault, "_ai", "state", "memory.db"));
  });
});
