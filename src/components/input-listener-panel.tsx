import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useRestartInputListener } from "@/lib/use-restart-input-listener";
import { Button } from "@/components/ui/button";
import { t, useT } from "@/lib/i18n";
import type { InputListenerDiagnostics } from "@/types";

/** The gesture features stop working when the shared Raw Input listener stops
 * delivering (a locked session, an RDP reconnect, a display change). The app
 * re-registers itself when it notices, but the recovery is invisible — this
 * panel makes the listener's state visible and offers the manual restart, so
 * "the Alt double-press stopped working" no longer means "restart the app". */
const REFRESH_MS = 2000;

function duration(ms: number | null): string {
  if (ms === null) return t("misc.inputListener.never");
  if (ms < 1000) return t("misc.inputListener.justNow");
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return t("misc.inputListener.secondsAgo", { count: secs });
  if (secs < 3600) return t("misc.inputListener.minutesAgo", { count: Math.floor(secs / 60) });
  return t("misc.inputListener.hoursAgo", { count: Math.floor(secs / 3600) });
}

function uptime(ms: number | null): string {
  if (ms === null) return t("misc.inputListener.notRunning");
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return t("misc.inputListener.minutesFmt", { count: mins });
  const hours = Math.floor(mins / 60);
  return t("misc.inputListener.hoursMinutesFmt", { hours, minutes: mins % 60 });
}

export function InputListenerPanel() {
  useT(); // subscribes this component to locale changes
  const [info, setInfo] = useState<InputListenerDiagnostics | null>(null);
  const { restart, restarting, restarted, error, setError } =
    useRestartInputListener(setInfo);

  const refresh = useCallback(async () => {
    try {
      setInfo(await api.inputListenerDiagnostics());
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Typing anywhere feeds the listener, so a long silence while the user is
  // clearly at the keyboard is the signature of a registration that died.
  const stale =
    info !== null &&
    info.running &&
    (info.last_input_ms_ago === null || info.last_input_ms_ago > 120_000);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("misc.inputListener.title")}</p>
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
          {t("misc.inputListener.restart")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("misc.inputListener.description")}</p>
      {info && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">{t("misc.inputListener.status")}</span>
          <span className={info.running ? "" : "text-amber-500"}>
            {info.running ? t("misc.inputListener.running") : t("misc.inputListener.notRunning")}
            {info.consumers.length > 0 && ` (${info.consumers.join(", ")})`}
          </span>
          <span className="text-muted-foreground">{t("misc.inputListener.uptime")}</span>
          <span>{uptime(info.uptime_ms)}</span>
          <span className="text-muted-foreground">{t("misc.inputListener.lastKeySeen")}</span>
          <span className={stale ? "text-amber-500" : ""}>
            {duration(info.last_input_ms_ago)}{" "}
            {t("misc.inputListener.totalSuffix", { count: info.input_count })}
          </span>
          <span className="text-muted-foreground">{t("misc.inputListener.reregistrations")}</span>
          <span>
            {info.reregistrations}{" "}
            {info.last_reregister_reason &&
              t("misc.inputListener.lastWithReason", {
                reason: info.last_reregister_reason,
                when: duration(info.last_reregister_ms_ago),
              })}
          </span>
          <span className="text-muted-foreground">{t("misc.inputListener.autoRebuilds")}</span>
          <span>
            {info.rebuilds}{" "}
            {info.last_rebuild_reason &&
              t("misc.inputListener.lastReasonOnly", { reason: info.last_rebuild_reason })}
          </span>
          <span className="text-muted-foreground">{t("misc.inputListener.manualRestarts")}</span>
          <span>{info.restarts}</span>
        </div>
      )}
      {stale && (
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("misc.inputListener.staleWarning")}
        </p>
      )}
      {info?.elevated_foreground && (
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("misc.inputListener.elevatedWarning")}
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
