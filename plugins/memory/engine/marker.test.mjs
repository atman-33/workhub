/**
 * A plugin update that raises ENGINE_VERSION switches every memory hook off
 * until `memory-setup` runs again. That used to happen in silence (T-0385), so
 * what is pinned here is that the stale state is told apart from "never set
 * up", and that the session brief says so in one line.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDoctor } from "./lib/doctor.mjs";
import { ENGINE_VERSION, markerStatus, readMarker, staleEngineNotice } from "./lib/paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const briefHook = join(here, "..", "hooks", "brief.mjs");

let dir;
let previousHome;

beforeEach(() => {
  dir = mkdtempSync(join(os.tmpdir(), "workhub-marker-"));
  previousHome = process.env.WORKHUB_ENGINE_HOME;
  process.env.WORKHUB_ENGINE_HOME = dir;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.WORKHUB_ENGINE_HOME;
  else process.env.WORKHUB_ENGINE_HOME = previousHome;
  rmSync(dir, { recursive: true, force: true });
});

function writeMarker(version) {
  writeFileSync(
    join(dir, ".setup-version"),
    JSON.stringify({ version, installedAt: "2026-09-19T00:00:00Z", model: "test" }),
  );
}

describe("markerStatus", () => {
  it("is missing when setup never ran", () => {
    expect(markerStatus().state).toBe("missing");
    expect(readMarker()).toBeNull();
  });

  it("is ok when the marker matches this engine", () => {
    writeMarker(ENGINE_VERSION);
    expect(markerStatus().state).toBe("ok");
    expect(readMarker()).not.toBeNull();
  });

  it("is stale, not missing, when an older plugin set it up", () => {
    writeMarker(ENGINE_VERSION - 1);
    const status = markerStatus();
    expect(status.state).toBe("stale");
    expect(status.installed).toBe(ENGINE_VERSION - 1);
    expect(readMarker()).toBeNull();
  });

  it("names both versions and the fix in the notice", () => {
    const notice = staleEngineNotice(ENGINE_VERSION - 1);
    expect(notice).toContain(String(ENGINE_VERSION - 1));
    expect(notice).toContain(String(ENGINE_VERSION));
    expect(notice).toContain("/memory-setup");
  });
});

describe("doctor on a stale engine", () => {
  it("fails setup with a re-run hint rather than 'no marker'", async () => {
    writeMarker(ENGINE_VERSION - 1);
    const report = await runDoctor();
    const setup = report.checks.find((c) => c.name === "setup");
    expect(setup.level).toBe("fail");
    expect(setup.detail).toContain(`expects ${ENGINE_VERSION}`);
  });
});

describe("brief hook", () => {
  function runBrief(vault) {
    return spawnSync(process.execPath, [briefHook], {
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, WORKHUB_ENGINE_HOME: dir, WORKHUB_VAULT: vault },
    });
  }

  it("prints one line when the engine is stale", () => {
    const vault = join(dir, "vault");
    mkdirSync(vault);
    writeMarker(ENGINE_VERSION - 1);
    const result = runBrief(vault);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.stdout).toContain("/memory-setup");
  });

  it("stays silent when setup never ran", () => {
    const vault = join(dir, "vault");
    mkdirSync(vault);
    const result = runBrief(vault);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});
