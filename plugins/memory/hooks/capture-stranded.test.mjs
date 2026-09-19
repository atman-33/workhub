/**
 * T-0392: the Stop hook must not create `_ai/state/memory.db` for a vault
 * whose memory is stranded under the pre-T-0390 `_ai/memory/` folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./../engine/lib/paths.mjs";

const captureHookPath = join(dirname(fileURLToPath(import.meta.url)), "capture.mjs");

let vault;
let engineHome;

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "workhub-capturehook-stranded-vault-"));
  engineHome = mkdtempSync(join(os.tmpdir(), "workhub-capturehook-stranded-home-"));
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

describe("capture Stop hook on a stranded vault", () => {
  it("no-ops instead of creating _ai/state/memory.db", () => {
    const transcript = join(vault, "transcript.jsonl");
    writeFileSync(transcript, "{}\n");
    const result = spawnSync(process.execPath, [captureHookPath], {
      input: JSON.stringify({ transcript_path: transcript, session_id: "s1" }),
      encoding: "utf8",
      env: { ...process.env, WORKHUB_VAULT: vault, WORKHUB_ENGINE_HOME: engineHome },
    });
    expect(existsSync(join(vault, "_ai", "state", "memory.db"))).toBe(false);
    expect(result.status).toBe(0);
  });
});
