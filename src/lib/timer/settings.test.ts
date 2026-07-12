import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMER_SETTINGS,
  clampDuration,
  loadTimerSettings,
  saveTimerSettings,
} from "./settings";

/** Minimal in-memory localStorage — the default vitest env is node, which has none. */
function stubStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set("workhub.timer.settings", initial);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clampDuration", () => {
  it("keeps sane values and clamps the rest", () => {
    expect(clampDuration(300)).toBe(300);
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(-10)).toBe(1);
    expect(clampDuration(999_999)).toBe(24 * 60 * 60);
    expect(clampDuration(60.4)).toBe(60);
    expect(clampDuration(Number.NaN)).toBe(DEFAULT_TIMER_SETTINGS.durationSec);
  });
});

describe("loadTimerSettings", () => {
  it("returns defaults when nothing is stored", () => {
    stubStorage();
    expect(loadTimerSettings()).toEqual(DEFAULT_TIMER_SETTINGS);
  });

  it("returns defaults when the stored value is not valid JSON", () => {
    stubStorage("{not json");
    expect(loadTimerSettings()).toEqual(DEFAULT_TIMER_SETTINGS);
  });

  it("falls back per-field when fields are missing or wrong-typed", () => {
    stubStorage(JSON.stringify({ durationSec: 900, volume: "loud" }));
    expect(loadTimerSettings()).toEqual({
      ...DEFAULT_TIMER_SETTINGS,
      durationSec: 900,
    });
  });

  it("clamps out-of-range stored values", () => {
    stubStorage(JSON.stringify({ durationSec: -1, volume: 5 }));
    const loaded = loadTimerSettings();
    expect(loaded.durationSec).toBe(1);
    expect(loaded.volume).toBe(1);
  });

  it("round-trips saved settings", () => {
    stubStorage();
    const settings = {
      durationSec: 1500,
      soundEnabled: false,
      volume: 0.2,
      notifyEnabled: false,
    };
    saveTimerSettings(settings);
    expect(loadTimerSettings()).toEqual(settings);
  });

  it("returns defaults when storage is unavailable", () => {
    expect(loadTimerSettings()).toEqual(DEFAULT_TIMER_SETTINGS);
  });
});
