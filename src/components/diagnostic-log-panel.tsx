import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, FolderOpen, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import type { DiagEntry, DiagLogInfo } from "@/types";

/** A packaged build has no console (`windows_subsystem = "windows"`), so
 * nothing the app records used to be readable after the fact — a bug seen in
 * the release build could only be chased by reproducing it in a dev build,
 * which does not work for probes that read another app's state at one instant.
 * This panel shows the same lines the log file holds, so a report can be
 * copied out of the app that produced it. */
const REFRESH_MS = 3000;
const SHOWN_LINES = 200;

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DiagnosticLogPanel() {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [info, setInfo] = useState<DiagLogInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [lines, meta] = await Promise.all([
        api.diagnosticLog(SHOWN_LINES),
        api.diagnosticLogInfo(),
      ]);
      setEntries(lines);
      setInfo(meta);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling is opt-in: the log is usually read once, and a settings dialog
  // left open should not keep invoking a command every few seconds.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const copy = () => {
    const text = entries.map((e) => `${e.time} ${e.message}`).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Diagnostic log</p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RotateCcw className="mr-1 size-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={copy}
            disabled={entries.length === 0}
          >
            {copied ? (
              <Check className="mr-1 size-3.5 text-green-500" />
            ) : (
              <Copy className="mr-1 size-3.5" />
            )}
            Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => info && void api.openExplorer(info.dir)}
            disabled={!info}
          >
            <FolderOpen className="mr-1 size-3.5" />
            Open folder
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        What the app recorded while it ran. The packaged build has no console
        window, so this — and the log file behind it — is where a problem you
        want to report leaves a trace. It holds what the app did (errors,
        timings, window placement), never what you typed, dictated, or copied.
      </p>
      <div
        ref={listRef}
        className="max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed"
      >
        {entries.length === 0 ? (
          <p className="text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          entries.map((e, i) => (
            <div key={`${e.time}-${i}`} className="whitespace-pre-wrap break-all">
              <span className="text-muted-foreground">{e.time}</span> {e.message}
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <Hint label={info?.path}>
          <span className="truncate">
            {info ? `${info.path} (${sizeLabel(info.bytes)})` : "…"}
          </span>
        </Hint>
        <label className="flex shrink-0 items-center gap-1.5">
          <Checkbox checked={live} onCheckedChange={(v) => setLive(v === true)} />
          Auto-refresh
        </label>
      </div>
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
