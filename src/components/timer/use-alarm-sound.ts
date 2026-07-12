import { useCallback, useEffect, useRef } from "react";

const BEEP_COUNT = 3;
const BEEP_SEC = 0.2;
const GAP_SEC = 0.15;
const FREQ_HZ = 880;

/**
 * Alarm beeps synthesized with the Web Audio API — no audio asset is bundled.
 *
 * The AudioContext is created lazily on the first play (which only happens
 * after the user has clicked Start), because a context constructed without a
 * prior user gesture starts suspended and stays silent.
 */
export function useAlarmSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<OscillatorNode[]>([]);

  const stop = useCallback(() => {
    for (const osc of nodesRef.current) {
      try {
        osc.stop();
      } catch {
        // already ended
      }
    }
    nodesRef.current = [];
  }, []);

  const play = useCallback(
    (volume: number) => {
      stop();
      const ctx = ctxRef.current ?? new AudioContext();
      ctxRef.current = ctx;
      void ctx.resume();

      for (let i = 0; i < BEEP_COUNT; i++) {
        const startAt = ctx.currentTime + i * (BEEP_SEC + GAP_SEC);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = FREQ_HZ;
        // Ramp in/out: a square-edged gain change pops audibly.
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(volume, startAt + 0.02);
        gain.gain.setValueAtTime(volume, startAt + BEEP_SEC - 0.02);
        gain.gain.linearRampToValueAtTime(0, startAt + BEEP_SEC);
        osc.connect(gain).connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + BEEP_SEC);
        osc.onended = () => {
          nodesRef.current = nodesRef.current.filter((n) => n !== osc);
        };
        nodesRef.current.push(osc);
      }
    },
    [stop],
  );

  useEffect(() => {
    return () => {
      stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [stop]);

  return { play, stop };
}
