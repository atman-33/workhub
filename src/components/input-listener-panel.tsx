import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { InputListenerDiagnostics } from "@/types";

/** The gesture features stop working when the shared Raw Input listener stops
 * delivering (a locked session, an RDP reconnect, a display change). The app
 * re-registers itself when it notices, but the recovery is invisible — this
 * panel makes the listener's state visible and offers the manual restart, so
 * "the Alt double-press stopped working" no longer means "restart the app". */
const REFRESH_MS = 2000;

function duration(ms: number | null): string {
  if (ms === null) return "never";
  if (ms < 1000) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function uptime(ms: number | null): string {
  if (ms === null) return "not running";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function InputListenerPanel() {
  const [info, setInfo] = useState<InputListenerDiagnostics | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await api.inputListenerDiagnostics());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const restart = async () => {
    setRestarting(true);
    setError(null);
    try {
      setInfo(await api.restartInputListener());
      setRestarted(true);
      setTimeout(() => setRestarted(false), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setRestarting(false);
    }
  };

  // Typing anywhere feeds the listener, so a long silence while the user is
  // clearly at the keyboard is the signature of a registration that died.
  const stale =
    info !== null &&
    info.running &&
    (info.last_input_ms_ago === null || info.last_input_ms_ago > 120_000);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Input listener</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void restart()}
          disabled={restarting}
        >
          {restarting ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : restarted ? (
            <Check className="mr-1 size-3.5 text-green-500" />
          ) : (
            <RotateCcw className="mr-1 size-3.5" />
          )}
          Restart listener
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The shared keyboard listener behind screen annotation (double-press Alt)
        and the clips popup. If a gesture stops responding, restart the listener
        here instead of restarting the app.
      </p>
      {info && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Status</span>
          <span className={info.running ? "" : "text-amber-500"}>
            {info.running ? "running" : "not running"}
            {info.consumers.length > 0 && ` (${info.consumers.join(", ")})`}
          </span>
          <span className="text-muted-foreground">Uptime</span>
          <span>{uptime(info.uptime_ms)}</span>
          <span className="text-muted-foreground">Last key seen</span>
          <span className={stale ? "text-amber-500" : ""}>
            {duration(info.last_input_ms_ago)} ({info.input_count} total)
          </span>
          <span className="text-muted-foreground">Re-registrations</span>
          <span>
            {info.reregistrations}
            {info.last_reregister_reason &&
              ` (last: ${info.last_reregister_reason}, ${duration(
                info.last_reregister_ms_ago,
              )})`}
          </span>
          <span className="text-muted-foreground">Auto rebuilds</span>
          <span>
            {info.rebuilds}
            {info.last_rebuild_reason &&
              ` (last: ${info.last_rebuild_reason})`}
          </span>
          <span className="text-muted-foreground">Manual restarts</span>
          <span>{info.restarts}</span>
        </div>
      )}
      {stale && (
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          No keystrokes have reached the listener recently. That is normal while
          you are away from the keyboard; if a gesture is not responding while
          you type, restart the listener.
        </p>
      )}
      {info?.elevated_foreground && (
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          An app running as administrator is in the foreground. Windows sends no
          keyboard input to normal-privilege apps while that is the case, so the
          gestures cannot work over it — restarting the listener will not help.
        </p>
      )}
      {(error || info?.last_error) && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error ?? info?.last_error}
        </p>
      )}
    </div>
  );
}
