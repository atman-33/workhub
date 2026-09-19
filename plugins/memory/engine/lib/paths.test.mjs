/**
 * `dbPathForVault` resolves `_ai/state/memory.db` only — T-0392 removed the
 * transitional fallback T-0390 added to the pre-rename `_ai/memory/` folder.
 * `legacyDbStranded` is the guard that replaces it: it tells a caller when a
 * vault's real database is still sitting under the old folder, so nothing
 * silently creates a second, empty one at the new path.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbPathForVault, legacyDbStranded } from "./paths.mjs";

let vault;

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "workhub-dbpath-"));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("dbPathForVault", () => {
  it("resolves _ai/state/memory.db regardless of a legacy _ai/memory/ folder", () => {
    mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
    expect(dbPathForVault(vault)).toBe(join(vault, "_ai", "state", "memory.db"));
  });

  it("resolves _ai/state/memory.db when nothing exists", () => {
    expect(dbPathForVault(vault)).toBe(join(vault, "_ai", "state", "memory.db"));
  });
});

describe("legacyDbStranded", () => {
  it("is false when there is no database anywhere", () => {
    expect(legacyDbStranded(vault)).toBe(false);
  });

  it("is false once _ai/state/memory.db exists, even beside a legacy one", () => {
    mkdirSync(join(vault, "_ai", "state"), { recursive: true });
    writeFileSync(join(vault, "_ai", "state", "memory.db"), "sqlite");
    mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
    writeFileSync(join(vault, "_ai", "memory", "memory.db"), "sqlite");
    expect(legacyDbStranded(vault)).toBe(false);
  });

  it("is true when only the legacy _ai/memory/memory.db exists", () => {
    mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
    writeFileSync(join(vault, "_ai", "memory", "memory.db"), "sqlite");
    expect(legacyDbStranded(vault)).toBe(true);
  });
});
