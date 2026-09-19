/**
 * The reflect reminder is only worth its line when there is something to
 * promote and it has been a while (T-0386): at least a week since the last
 * run, and a conversation captured after it. Both halves are pinned here, plus
 * the once-per-session gate the OpenCode path relies on.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REFLECT_INTERVAL_DAYS,
  firstPromptOf,
  markReflected,
  readReflectState,
  reflectDueLine,
  setupTime,
} from "./lib/reflect.mjs";

const DAY = 86400;
const NOW = 1_800_000_000;

let dir;
let previousHome;

beforeEach(() => {
  dir = mkdtempSync(join(os.tmpdir(), "workhub-reflect-"));
  previousHome = process.env.WORKHUB_ENGINE_HOME;
  process.env.WORKHUB_ENGINE_HOME = dir;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.WORKHUB_ENGINE_HOME;
  else process.env.WORKHUB_ENGINE_HOME = previousHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("reflectDueLine", () => {
  it("asks once a week has passed and something new was captured", () => {
    markReflected(NOW - REFLECT_INTERVAL_DAYS * DAY);
    const line = reflectDueLine({ last_session_at: NOW - DAY }, { now: NOW });
    expect(line).toContain("memory-reflect");
    expect(line).toContain(`${REFLECT_INTERVAL_DAYS} 日`);
  });

  it("stays quiet inside the week", () => {
    markReflected(NOW - (REFLECT_INTERVAL_DAYS - 1) * DAY);
    expect(reflectDueLine({ last_session_at: NOW - 60 }, { now: NOW })).toBe("");
  });

  it("stays quiet when nothing was captured since the last run", () => {
    markReflected(NOW - 30 * DAY);
    expect(reflectDueLine({ last_session_at: NOW - 31 * DAY }, { now: NOW })).toBe("");
  });

  it("stays quiet with an empty database", () => {
    markReflected(NOW - 30 * DAY);
    expect(reflectDueLine({ last_session_at: null }, { now: NOW })).toBe("");
  });

  it("counts from setup when reflect never ran", () => {
    expect(readReflectState().lastReflectAt).toBeNull();
    const stats = { last_session_at: NOW - DAY };
    expect(reflectDueLine(stats, { since: NOW - 2 * DAY, now: NOW })).toBe("");
    expect(reflectDueLine(stats, { since: NOW - 10 * DAY, now: NOW })).toContain("一度も");
  });

  it("stays quiet with no stamp and no setup time", () => {
    expect(reflectDueLine({ last_session_at: NOW }, { now: NOW })).toBe("");
  });
});

describe("setupTime", () => {
  it("reads the marker's installedAt", () => {
    writeFileSync(
      join(dir, ".setup-version"),
      JSON.stringify({ version: 0, installedAt: "2026-09-18T00:00:00.000Z" }),
    );
    // A marker for another engine version is not usable, so there is no time.
    expect(setupTime()).toBeNull();
  });
});

describe("firstPromptOf", () => {
  it("is true once per session", () => {
    expect(firstPromptOf("s1")).toBe(true);
    expect(firstPromptOf("s1")).toBe(false);
    expect(firstPromptOf("s2")).toBe(true);
  });

  it("is false without a session id", () => {
    expect(firstPromptOf("")).toBe(false);
  });
});
