import { useCallback, useEffect, useRef, useState } from "react";

const TICK_MS = 250;

/**
 * Countdown driven by a deadline timestamp rather than an accumulated tick
 * count — an interval that fires late (throttled tab, busy main thread) would
 * otherwise make the timer drift behind wall-clock time.
 */
export function useCountdown(onFinish: () => void) {
  const [remainingMs, setRemainingMs] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const deadlineRef = useRef(0);
  const intervalRef = useRef<number | undefined>(undefined);
  // Kept in a ref so a re-created callback never restarts the interval.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const clearTick = useCallback(() => {
    window.clearInterval(intervalRef.current);
    intervalRef.current = undefined;
  }, []);

  const startTick = useCallback(() => {
    clearTick();
    intervalRef.current = window.setInterval(() => {
      const left = deadlineRef.current - Date.now();
      if (left <= 0) {
        clearTick();
        setRemainingMs(0);
        setIsRunning(false);
        onFinishRef.current();
        return;
      }
      setRemainingMs(left);
    }, TICK_MS);
  }, [clearTick]);

  useEffect(() => clearTick, [clearTick]);

  const start = useCallback(
    (seconds: number) => {
      deadlineRef.current = Date.now() + seconds * 1000;
      setRemainingMs(seconds * 1000);
      setIsRunning(true);
      startTick();
    },
    [startTick],
  );

  const pause = useCallback(() => {
    clearTick();
    setRemainingMs(Math.max(0, deadlineRef.current - Date.now()));
    setIsRunning(false);
  }, [clearTick]);

  const resume = useCallback(() => {
    if (remainingMs <= 0) return;
    deadlineRef.current = Date.now() + remainingMs;
    setIsRunning(true);
    startTick();
  }, [remainingMs, startTick]);

  const reset = useCallback(() => {
    clearTick();
    deadlineRef.current = 0;
    setRemainingMs(0);
    setIsRunning(false);
  }, [clearTick]);

  return {
    /** Remaining time, rounded up so the display shows "0:00" only at zero. */
    remainingSec: Math.ceil(remainingMs / 1000),
    remainingMs,
    isRunning,
    start,
    pause,
    resume,
    reset,
  };
}
