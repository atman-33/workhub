const STORAGE_KEY = "workhub.timer.settings";

export interface TimerSettings {
  /** Duration selected for the next run, in seconds. */
  durationSec: number;
  soundEnabled: boolean;
  /** 0..1, applied to the alarm gain node. */
  volume: number;
  notifyEnabled: boolean;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  durationSec: 30 * 60,
  soundEnabled: true,
  volume: 0.5,
  notifyEnabled: true,
};

/** Preset durations (minutes) offered as one-click buttons. */
export const PRESET_MINUTES = [5, 15, 30, 60];

export const MIN_DURATION_SEC = 1;
export const MAX_DURATION_SEC = 24 * 60 * 60;

export function clampDuration(sec: number): number {
  if (!Number.isFinite(sec)) return DEFAULT_TIMER_SETTINGS.durationSec;
  return Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, Math.round(sec)));
}

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_TIMER_SETTINGS.volume;
  return Math.min(1, Math.max(0, v));
}

/** Read persisted settings; any corrupt or missing field falls back to its default. */
export function loadTimerSettings(): TimerSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_TIMER_SETTINGS;
  }
  if (!raw) return DEFAULT_TIMER_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_TIMER_SETTINGS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_TIMER_SETTINGS;

  const o = parsed as Record<string, unknown>;
  return {
    durationSec:
      typeof o.durationSec === "number"
        ? clampDuration(o.durationSec)
        : DEFAULT_TIMER_SETTINGS.durationSec,
    soundEnabled:
      typeof o.soundEnabled === "boolean"
        ? o.soundEnabled
        : DEFAULT_TIMER_SETTINGS.soundEnabled,
    volume:
      typeof o.volume === "number" ? clampVolume(o.volume) : DEFAULT_TIMER_SETTINGS.volume,
    notifyEnabled:
      typeof o.notifyEnabled === "boolean"
        ? o.notifyEnabled
        : DEFAULT_TIMER_SETTINGS.notifyEnabled,
  };
}

export function saveTimerSettings(settings: TimerSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode / quota) — settings are non-critical
  }
}
