import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Puzzle, RefreshCw } from "lucide-react";

import { PluginDetailsButton, PluginDetailsDialog } from "@/components/plugin-details-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import {
  pluginProblems,
  pluginSuggestions,
  pluginViews,
  type PluginStatus,
  type PluginView,
} from "@/lib/plugins";
import { cn } from "@/lib/utils";
import type { PluginCommandResult, PluginsState } from "@/types";

/**
 * Plugins tab — is this machine's workhub harness complete and current?
 *
 * Three questions the owner otherwise has to answer by reading four JSON files
 * by hand: which plugins a vault cannot work without, which of them are
 * actually switched on here, and whether what is installed is behind the
 * marketplace. The `claude-tooling` plugin's SessionStart hook already reports
 * the third one, but only inside a session, only once per new version, and
 * never the first two.
 *
 * Everything shown is read from local Claude Code state. The two buttons that
 * change anything shell out to the `claude plugin` CLI, and the enable/disable
 * switch edits one `enabledPlugins` key — all three take effect in the next
 * Claude Code session, which is why the footer says so rather than pretending
 * a running session picks them up.
 */

const STATUS_LABEL: Record<PluginStatus, string> = {
  missing: "Required, off",
  outdated: "Update available",
  advised: "Recommended, off",
  pending: "Installs next launch",
  unknown: "Version unknown",
  ok: "Up to date",
  off: "Off",
};

const STATUS_CLASS: Record<PluginStatus, string> = {
  missing: "border-destructive/50 bg-destructive/10 text-destructive",
  outdated: "border-amber-500/50 bg-amber-500/10 text-amber-600",
  // A suggestion, not a fault: no fill, no alarm colour.
  advised: "border-primary/40 text-primary",
  pending: "border-blue-500/50 bg-blue-500/10 text-blue-600",
  unknown: "text-muted-foreground",
  ok: "border-emerald-500/40 text-emerald-600",
  off: "text-muted-foreground",
};

const TIER_LABEL: Record<string, string> = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function PluginCard({
  view,
  busy,
  onToggle,
  onUpdate,
  onOpenDetails,
}: {
  view: PluginView;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
  onOpenDetails: () => void;
}) {
  const scope = view.scope || "unlisted";
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded border p-3",
        view.status === "missing" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{view.name}</span>
          <Badge
            className={cn(
              view.tier === "required" && "border-primary/40 text-primary",
              view.tier === "recommended" && "border-primary/25 text-primary/80",
              view.tier !== "required" && view.tier !== "recommended" && "text-muted-foreground",
            )}
          >
            {TIER_LABEL[view.tier] ?? "Unlisted"}
          </Badge>
          <Badge className="text-muted-foreground">{scope}</Badge>
          {view.extra && (
            <Hint label="Installed or enabled, but absent from the marketplace catalog">
              <Badge className="border-amber-500/50 text-amber-600">Not in catalog</Badge>
            </Hint>
          )}
          <Badge className={STATUS_CLASS[view.status]}>{STATUS_LABEL[view.status]}</Badge>
        </div>
        {view.summary && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{view.summary}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span>{view.installed_version || "not installed"}</span>
          {view.latest_version && view.latest_version !== view.installed_version && (
            <>
              <ArrowRight className="size-3" />
              <span
                className={cn(view.status === "outdated" && "font-medium text-amber-600")}
              >
                {view.latest_version}
              </span>
            </>
          )}
          <span className="text-muted-foreground/70">
            · {view.enabled ? `on (${view.effective_scope})` : "off"}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Hint label="What this plugin puts into a session: skills, agents, commands, hooks">
          <span>
            <PluginDetailsButton onOpen={onOpenDetails} />
          </span>
        </Hint>
        {view.status === "outdated" && (
          <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={onUpdate}>
            Update
          </Button>
        )}
        <Hint
          label={
            view.enabled
              ? `Disable in the ${view.effective_scope} settings.json`
              : `Enable in the ${view.effective_scope} settings.json`
          }
        >
          <span>
            <Switch checked={view.enabled} disabled={busy} onCheckedChange={onToggle} />
          </span>
        </Hint>
      </div>
    </div>
  );
}

export function PluginsView({ active, vaultPath }: { active: boolean; vaultPath: string }) {
  const [state, setState] = useState<PluginsState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PluginCommandResult | null>(null);
  /** The plugin whose contents are being read; null keeps the dialog closed. */
  const [details, setDetails] = useState<PluginView | null>(null);

  const load = useCallback(async () => {
    setState(await api.pluginsState(vaultPath));
    setLoaded(true);
  }, [vaultPath]);

  useEffect(() => {
    if (active) void load().catch((e) => setError(String(e)));
  }, [active, load]);

  const views = useMemo(() => (state ? pluginViews(state) : []), [state]);
  const problems = useMemo(() => pluginProblems(views), [views]);
  const suggestions = useMemo(() => pluginSuggestions(views), [views]);
  const missing = problems.filter((p) => p.status === "missing");
  const outdated = problems.filter((p) => p.status === "outdated");

  /** Every action ends by re-reading the state, so the list never lies. */
  const run = async (action: () => Promise<PluginCommandResult | PluginsState | void>) => {
    setBusy(true);
    setError(null);
    try {
      const out = await action();
      if (out && "command" in out) {
        setResult(out);
        if (!out.ok) setError(`${out.command} failed`);
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Puzzle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-sm font-medium">{state?.marketplace}</h2>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Plugins from the workhub marketplace: how much this vault needs each one,
                what is installed here, and what the marketplace clone offers.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Hint label="Re-read the local Claude Code state">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                disabled={busy}
                onClick={() => void run(load)}
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              </Button>
            </Hint>
            <Hint label={`claude plugin marketplace update ${state?.marketplace}`}>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={busy}
                onClick={() => void run(() => api.pluginsUpdateMarketplace(vaultPath))}
              >
                Update marketplace
              </Button>
            </Hint>
          </div>
        </div>

        {!state?.clone_found && (
          <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <p className="leading-relaxed">
              The marketplace is not cloned on this machine, so no version can be compared.
              Register it with <code>claude plugin marketplace add atman-33/workhub</code>.
            </p>
          </div>
        )}

        {state?.clone_found && !state.catalog_found && (
          <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <p className="leading-relaxed">
              The marketplace clone carries no <code>.claude-plugin/catalog.json</code>, so
              nothing here knows which plugins are required. Update the marketplace to pick
              it up.
            </p>
          </div>
        )}

        {missing.length > 0 && (
          <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <p className="leading-relaxed">
              <span className="font-medium">
                {missing.length} required {missing.length === 1 ? "plugin is" : "plugins are"}{" "}
                switched off
              </span>{" "}
              ({missing.map((m) => m.name).join(", ")}). Something in the app stops working
              without them — a task launch, a tab's AI edit, or the repositories the app
              hands to an agent.
            </p>
          </div>
        )}

        {outdated.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {outdated.length} {outdated.length === 1 ? "plugin is" : "plugins are"} behind the
            marketplace clone.
          </p>
        )}

        {suggestions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {suggestions.length} recommended{" "}
            {suggestions.length === 1 ? "plugin is" : "plugins are"} off (
            {suggestions.map((s) => s.name).join(", ")}). Nothing breaks — the harness is
            just poorer for it.
          </p>
        )}

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-2">
          {views.map((view) => (
            <PluginCard
              key={view.name}
              view={view}
              busy={busy}
              onToggle={(enabled) =>
                void run(() =>
                  api.setPluginEnabled(vaultPath, view.name, view.effective_scope, enabled),
                )
              }
              onUpdate={() =>
                void run(() =>
                  api.pluginsUpdatePlugin(vaultPath, view.name, view.effective_scope),
                )
              }
              onOpenDetails={() => setDetails(view)}
            />
          ))}
        </div>

        {result && (
          <div className="space-y-1 rounded border p-3">
            <p className="font-mono text-[11px] text-muted-foreground">{result.command}</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">
              {result.output || (result.ok ? "done" : "failed with no output")}
            </pre>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Enabling, disabling and updating all take effect in the next Claude Code session —
          restart any session that is open. Enabled state is written to{" "}
          <code>{state?.project_settings_path || "the vault settings"}</code> (project scope)
          and <code>{state?.user_settings_path}</code> (user scope).
        </p>
      </div>

      <PluginDetailsDialog
        view={details}
        vaultPath={vaultPath}
        onClose={() => setDetails(null)}
      />
    </div>
  );
}
