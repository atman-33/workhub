import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { Bell, BellOff, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatRemaining } from "@/lib/timer/format";
import {
  clampDuration,
  loadTimerSettings,
  PRESET_MINUTES,
  saveTimerSettings,
  type TimerSettings,
} from "@/lib/timer/settings";
import { cn } from "@/lib/utils";
import { useAlarmSound } from "./use-alarm-sound";
import { useCountdown } from "./use-countdown";

const RADIUS = 88;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

async function notifyTimesUp(minutes: number) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  sendNotification({
    title: "Time's up",
    body: `Your ${minutes}-minute timer has finished.`,
  });
}

export function TimerView() {
  const [settings, setSettings] = useState<TimerSettings>(loadTimerSettings);
  const [minutesInput, setMinutesInput] = useState(() =>
    String(Math.round(loadTimerSettings().durationSec / 60)),
  );
  const [finished, setFinished] = useState(false);
  const { play, stop } = useAlarmSound();
  // Read inside onFinish so the callback never goes stale on a settings change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const handleFinish = useCallback(() => {
    const { soundEnabled, volume, notifyEnabled, durationSec } = settingsRef.current;
    setFinished(true);
    if (soundEnabled) play(volume);
    if (notifyEnabled) void notifyTimesUp(Math.round(durationSec / 60));
  }, [play]);

  const { remainingSec, remainingMs, isRunning, start, pause, resume, reset } =
    useCountdown(handleFinish);

  useEffect(() => {
    saveTimerSettings(settings);
  }, [settings]);

  const patch = (next: Partial<TimerSettings>) => setSettings((s) => ({ ...s, ...next }));

  const selectDuration = (sec: number) => {
    const clamped = clampDuration(sec);
    patch({ durationSec: clamped });
    setMinutesInput(String(Math.round(clamped / 60)));
    if (isRunning) start(clamped);
  };

  const dismiss = () => {
    stop();
    setFinished(false);
    reset();
  };

  const handleStart = () => {
    setFinished(false);
    if (remainingMs > 0 && !isRunning) resume();
    else start(settings.durationSec);
  };

  const handleReset = () => {
    stop();
    setFinished(false);
    reset();
  };

  const isIdle = !isRunning && remainingMs === 0;
  const displaySec = isIdle ? settings.durationSec : remainingSec;
  const progress = isIdle ? 1 : Math.min(1, remainingMs / (settings.durationSec * 1000));

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-6">
      <div className="relative flex size-52 items-center justify-center">
        <svg className="absolute size-52 -rotate-90" viewBox="0 0 200 200">
          <circle
            cx="100"
            cy="100"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            className="stroke-muted"
          />
          <circle
            cx="100"
            cy="100"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            className={cn(
              "transition-[stroke-dashoffset] duration-200 ease-linear",
              finished ? "stroke-destructive" : "stroke-primary",
            )}
          />
        </svg>
        <div className="flex flex-col items-center">
          <span className="font-mono text-4xl font-semibold tabular-nums">
            {formatRemaining(displaySec)}
          </span>
          {finished && (
            <span className="mt-1 text-xs font-medium text-destructive">Time's up</span>
          )}
        </div>
      </div>

      {finished ? (
        <Button onClick={dismiss}>Dismiss</Button>
      ) : (
        <div className="flex items-center gap-2">
          <Button onClick={isRunning ? pause : handleStart} className="w-24">
            {isRunning ? (
              <>
                <Pause className="size-4" /> Pause
              </>
            ) : (
              <>
                <Play className="size-4" /> {remainingMs > 0 ? "Resume" : "Start"}
              </>
            )}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={isIdle}>
            <RotateCcw className="size-4" /> Reset
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {PRESET_MINUTES.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={settings.durationSec === m * 60 ? "secondary" : "outline"}
            onClick={() => selectDuration(m * 60)}
          >
            {m} min
          </Button>
        ))}
        <div className="ml-2 flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            max={1440}
            value={minutesInput}
            onChange={(e) => setMinutesInput(e.target.value)}
            onBlur={() => {
              const parsed = Number(minutesInput);
              if (Number.isFinite(parsed) && parsed > 0) selectDuration(parsed * 60);
              else setMinutesInput(String(Math.round(settings.durationSec / 60)));
            }}
            className="h-8 w-20"
          />
          <span className="text-xs text-muted-foreground">min</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-md border p-3 text-xs">
        <div className="flex items-center gap-3">
          {settings.soundEnabled ? (
            <Volume2 className="size-4 text-muted-foreground" />
          ) : (
            <VolumeX className="size-4 text-muted-foreground" />
          )}
          <span className="w-20">Alarm sound</span>
          <Switch
            checked={settings.soundEnabled}
            onCheckedChange={(v) => patch({ soundEnabled: v })}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            disabled={!settings.soundEnabled}
            onChange={(e) => patch({ volume: Number(e.target.value) })}
            onMouseUp={() => settings.soundEnabled && play(settings.volume)}
            className="w-28 accent-primary disabled:opacity-40"
            aria-label="Alarm volume"
          />
        </div>
        <div className="flex items-center gap-3">
          {settings.notifyEnabled ? (
            <Bell className="size-4 text-muted-foreground" />
          ) : (
            <BellOff className="size-4 text-muted-foreground" />
          )}
          <span className="w-20">Notification</span>
          <Switch
            checked={settings.notifyEnabled}
            onCheckedChange={(v) => patch({ notifyEnabled: v })}
          />
          <span className="text-muted-foreground">Desktop notification when time is up</span>
        </div>
      </div>
    </div>
  );
}
