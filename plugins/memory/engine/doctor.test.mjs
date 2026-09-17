/**
 * `doctor` is the answer to "did anyone notice?" — the question that went
 * unanswered for 46 days while capture failed on 93% of sessions (T-0366).
 *
 * So the properties worth pinning are not the wording of the checks but the
 * two that make it usable at all: it reports rather than throws on a broken
 * install, and a failure is visible in the verdict and the exit status instead
 * of being buried in a line of prose.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDoctor, runDoctor } from "./lib/doctor.mjs";

let dir;
let previousHome;
let previousVault;

beforeEach(() => {
  dir = mkdtempSync(join(os.tmpdir(), "workhub-doctor-"));
  previousHome = process.env.WORKHUB_ENGINE_HOME;
  previousVault = process.env.WORKHUB_VAULT;
  process.env.WORKHUB_ENGINE_HOME = dir;
});

afterEach(() => {
  for (const [name, value] of [
    ["WORKHUB_ENGINE_HOME", previousHome],
    ["WORKHUB_VAULT", previousVault],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

function levelOf(report, name) {
  return report.checks.find((c) => c.name === name)?.level;
}

describe("runDoctor", () => {
  it("reports a missing install instead of throwing", () => {
    process.env.WORKHUB_VAULT = dir;
    // No marker, no engine copy, no model, no database modules — the worst
    // case, and exactly when a health check has to work.
    const report = runDoctor({ sqlite: null, dbLib: null });

    expect(report.worst).toBe("fail");
    expect(levelOf(report, "setup")).toBe("fail");
    expect(levelOf(report, "engine copy")).toBe("fail");
    expect(levelOf(report, "model cache")).toBe("warn");
  });

  it("carries an action for every problem it reports", () => {
    process.env.WORKHUB_VAULT = dir;
    const report = runDoctor({ sqlite: null, dbLib: null });
    // A diagnosis nobody can act on is just a different way of saying nothing.
    for (const c of report.checks.filter((c) => c.level === "fail")) {
      expect(c.fix, c.name).toBeTruthy();
    }
  });

  it("says capture has never run rather than implying it is idle", () => {
    process.env.WORKHUB_VAULT = dir;
    const capture = runDoctor({ sqlite: null, dbLib: null }).checks.find(
      (c) => c.name === "capture",
    );
    expect(capture.level).toBe("warn");
    expect(capture.detail).toMatch(/never|has ever/);
  });

  it("raises the verdict when capture is failing in a row", () => {
    process.env.WORKHUB_VAULT = dir;
    writeFileSync(
      join(dir, "capture-state.json"),
      JSON.stringify({
        lastSuccessAt: Date.now() / 1000,
        consecutiveFailures: 4,
        lastError: "database is locked",
      }),
    );
    const report = runDoctor({ sqlite: null, dbLib: null });
    const failing = report.checks.find((c) => c.name === "capture failures");
    expect(failing.level).toBe("fail");
    expect(failing.detail).toMatch(/database is locked/);
  });

  it("flags a capture that stopped a fortnight ago", () => {
    process.env.WORKHUB_VAULT = dir;
    writeFileSync(
      join(dir, "capture-state.json"),
      JSON.stringify({
        lastSuccessAt: Date.now() / 1000 - 46 * 86400,
        consecutiveFailures: 0,
      }),
    );
    const capture = runDoctor({ sqlite: null, dbLib: null }).checks.find(
      (c) => c.name === "capture",
    );
    expect(capture.level).toBe("warn");
    expect(capture.detail).toMatch(/46 days ago/);
  });

  it("reports queued sessions as recoverable, not lost", () => {
    process.env.WORKHUB_VAULT = dir;
    const transcript = join(dir, "queued.jsonl");
    writeFileSync(transcript, "{}\n");
    writeFileSync(
      join(dir, "capture-queue.jsonl"),
      `${JSON.stringify({ transcript, task: "", queuedAt: Date.now() / 1000 })}\n`,
    );
    const queue = runDoctor({ sqlite: null, dbLib: null }).checks.find(
      (c) => c.name === "capture queue",
    );
    expect(queue.level).toBe("warn");
    expect(queue.fix).toMatch(/capture-retry/);
  });
});

describe("formatDoctor", () => {
  it("ends with a verdict a reader can act on", () => {
    const lines = formatDoctor({
      checks: [{ name: "setup", level: "fail", detail: "missing", fix: "run memory-setup" }],
      worst: "fail",
    });
    expect(lines.at(-1)).toMatch(/not working/);
    expect(lines.join("\n")).toContain("run memory-setup");
  });

  it("says so plainly when everything passes", () => {
    const lines = formatDoctor({
      checks: [{ name: "setup", level: "ok", detail: "installed" }],
      worst: "ok",
    });
    expect(lines.at(-1)).toBe("memory is healthy.");
  });
});
