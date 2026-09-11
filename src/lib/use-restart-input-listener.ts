import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { InputListenerDiagnostics } from "@/types";

/** How long the "restarted" confirmation stays visible after a success. */
const CONFIRM_MS = 3000;

/**
 * The manual "Restart listener" action, shared by the Settings panel that
 * shows the listener's diagnostics and the nav-bar button that offers the
 * same restart without opening Settings (T-0280). Both need the same three
 * states — in flight, just succeeded, failed — so they live here once.
 *
 * `onRestarted` receives the diagnostics the restart returned, so a caller
 * that renders them can update without waiting for its next poll.
 */
export function useRestartInputListener(
  onRestarted?: (info: InputListenerDiagnostics) => void,
) {
  const [restarting, setRestarting] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const restart = useCallback(async () => {
    setRestarting(true);
    setError(null);
    try {
      const info = await api.restartInputListener();
      onRestarted?.(info);
      setRestarted(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRestarted(false), CONFIRM_MS);
    } catch (e) {
      setError(String(e));
    } finally {
      setRestarting(false);
    }
  }, [onRestarted]);

  return { restart, restarting, restarted, error, setError };
}
