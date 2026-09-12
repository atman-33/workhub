import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AlertTriangle, Check, Copy, Loader2, Play, RotateCcw, Settings2 } from "lucide-react";

import { ModelCombobox } from "@/components/model-combobox";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { VaultScopedBadge } from "@/components/vault-scoped-badge";
import { api, timeAgo } from "@/lib/api";
import type { Settings, TidyRun } from "@/types";

/**
 * The Inbox tab's own settings: the vault tidy routine (T-0300).
 *
 * Tidy is what files stale `inbox/` notes and parks the proposals this tab
 * lists, so its schedule belongs next to them rather than three tabs away in
 * the settings dialog. Same move the Voice, Ink, Clips, Docs, Schedule and
 * Mindmap tabs already made (`.claude/rules/settings-placement.md`).
 *
 * Every change saves immediately through the caller's `onPatch`, which merges
 * onto a fresh read of the config so a value another tab changed meanwhile is
 * not reverted (T-0281). `tidy` is one object carrying both vault-scoped
 * policy and machine-local run state, so it is patched field by field onto the
 * settings the caller holds — never replaced wholesale.
 */

/** Timestamps read the same on a Japanese Windows as on an English one. */
const TIMESTAMP = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Next scheduled check time from anchor + interval (unix seconds). */
function nextCheck(tidy: Settings["tidy"]): number | null {
  if (!tidy.anchor) return null;
  const interval = Math.max(1, tidy.interval_hours) * 3600;
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - tidy.anchor);
  return tidy.anchor + (Math.floor(elapsed / interval) + 1) * interval;
}

interface Props {
  settings: Settings | null;
  disabled?: boolean;
  onPatch: (patch: Partial<Settings>) => void;
}

export function InboxSettings({ settings, disabled, onPatch }: Props) {
  const [open, setOpen] = useState(false);
  const [tidyRun, setTidyRun] = useState<TidyRun | null>(null);
  const [msg, setMsg] = useState("");

  const tidy = settings?.tidy ?? null;
  const ready = tidy != null;

  // Status is read when the popover opens and then followed live, so a run
  // started from here reports back without reopening it.
  useEffect(() => {
    if (!open) return;
    setMsg("");
    void api.tidyStatus().then(setTidyRun).catch(() => {});
    const unlisten = listen<TidyRun>("tidy:status", (event) => setTidyRun(event.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [open]);

  const setTidy = (patch: Partial<Settings["tidy"]>) => {
    if (!tidy) return;
    onPatch({ tidy: { ...tidy, ...patch } });
  };

  const run = async () => {
    setMsg("");
    try {
      setMsg(await api.runVaultTidyNow(false));
      setTidyRun(await api.tidyStatus());
    } catch (e) {
      setMsg(String(e));
    }
  };

  const resume = async () => {
    setMsg("");
    try {
      setMsg(await api.resumeTidySession());
    } catch (e) {
      setMsg(String(e));
    }
  };

  /** Live run first, then the id persisted in settings — the latter is all
   * that survives an app restart. */
  const sessionId = tidyRun?.session_id || tidy?.last_session_id || "";

  const copySessionId = async () => {
    if (!sessionId) return;
    try {
      await writeText(sessionId);
      setMsg("Session id copied.");
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="Inbox settings" disabled={disabled || !ready}>
        <PopoverTrigger asChild>
          <Button size="icon-xs" variant="ghost" disabled={disabled || !ready}>
            <Settings2 className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-[22rem] space-y-3 p-3 text-xs" align="end">
        {tidy && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  Vault tidy
                  <VaultScopedBadge />
                </p>
                <p className="text-xs text-muted-foreground">
                  File stale inbox notes and refresh the archive index with a headless agent.
                </p>
              </div>
              <Switch checked={tidy.enabled} onCheckedChange={(v) => setTidy({ enabled: v })} />
            </div>

            {tidyRun && (
              <div className="rounded-md bg-muted p-2 text-xs">
                {tidyRun.state === "running" ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" />
                    {tidyRun.stalled ? "Running — may be stuck" : "Running…"}
                  </span>
                ) : tidyRun.state === "failed" ? (
                  <span className="flex items-start gap-1.5 text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>Failed{tidyRun.error ? `: ${tidyRun.error}` : ""}</span>
                  </span>
                ) : tidyRun.state === "completed" ? (
                  <span className="flex items-start gap-1.5">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-green-500" />
                    <span>{tidyRun.summary ?? "Completed"}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Idle</span>
                )}
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {tidyRun.at
                    ? `Last run ${timeAgo(tidyRun.at)}. `
                    : tidy.last_run
                      ? `Last run ${timeAgo(tidy.last_run)}. `
                      : "Not run yet. "}
                  {tidy.enabled && nextCheck(tidy)
                    ? `Next check ${TIMESTAMP.format(new Date((nextCheck(tidy) as number) * 1000))}.`
                    : ""}
                </div>
                {sessionId && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="shrink-0">Session</span>
                    <code className="truncate font-mono">{sessionId}</code>
                    <Hint label="Copy session id">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-5 shrink-0"
                        onClick={() => void copySessionId()}
                      >
                        <Copy className="size-3" />
                      </Button>
                    </Hint>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Agent</label>
                <Select
                  value={tidy.assignee}
                  // Model ids are per-CLI, so clear the model when the agent
                  // changes rather than passing a claude id to `--model` on an
                  // opencode run.
                  onValueChange={(v) => setTidy({ assignee: v, model: "" })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-code">Claude Code</SelectItem>
                    <SelectItem value="opencode">OpenCode</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model</label>
                <ModelCombobox
                  assignee={tidy.assignee}
                  value={tidy.model}
                  onChange={(model) => setTidy({ model })}
                  active={open}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">First run at</label>
                <DateTimePicker
                  value={tidy.anchor}
                  onChange={(anchor) => setTidy({ anchor })}
                  placeholder="not scheduled"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Run every (hours)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={tidy.interval_hours}
                  onChange={(e) =>
                    setTidy({ interval_hours: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Inbox age (days)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={tidy.stale_days}
                  onChange={(e) => setTidy({ stale_days: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Exclude folders</label>
                <Input
                  value={tidy.exclude_dirs.join(", ")}
                  onChange={(e) =>
                    setTidy({
                      exclude_dirs: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="_wip"
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">24 = daily, 168 = weekly.</p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void run()}
                disabled={tidyRun?.state === "running"}
              >
                <Play className="mr-1.5 size-3.5" />
                Run now
              </Button>
              {/* Any known session id is resumable — a run that was killed
                  mid-way never reports a failure, but is exactly the one
                  worth picking up by hand. */}
              {(sessionId || tidyRun?.state === "failed" || tidyRun?.stalled) && (
                <Button type="button" size="sm" variant="secondary" onClick={() => void resume()}>
                  <RotateCcw className="mr-1.5 size-3.5" />
                  Resume session
                </Button>
              )}
            </div>
            {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
