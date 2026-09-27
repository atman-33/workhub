import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Puzzle, RefreshCw } from "lucide-react";

import { PluginDetailsDialog } from "@/components/plugin-details-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { t as i18nT, useT, type MessageKey } from "@/lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  pluginProblems,
  pluginsOfMarketplace,
  pluginSuggestions,
  pluginViews,
  type PluginStatus,
  type PluginView,
} from "@/lib/plugins";
import { cn } from "@/lib/utils";
import type { MarketplaceInfo, PluginCommandResult, PluginsState } from "@/types";

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
 *
 * Two tabs (T-0238). The workhub marketplace keeps the whole tab it had: it is
 * the only one with a catalog, so it is the only one that can say a plugin is
 * required and switched off. The second tab holds every other marketplace the
 * machine has registered, and shows only plugins actually installed or enabled
 * — listing what each one *offers* would put some 500 rows on screen for the
 * two `claude-plugins-official` plugins in use. They are kept apart rather than
 * merged because the two lists answer different questions: "is my harness
 * complete" against "what else is loading in my sessions".
 */

const STATUS_LABEL_KEY: Record<PluginStatus, MessageKey> = {
  missing: "plugins.status.missing",
  outdated: "plugins.status.outdated",
  advised: "plugins.status.advised",
  pending: "plugins.status.pending",
  unknown: "plugins.status.unknown",
  ok: "plugins.status.ok",
  off: "plugins.status.off",
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

const TIER_LABEL_KEY: Record<string, MessageKey> = {
  required: "plugins.tier.required",
  recommended: "plugins.tier.recommended",
  optional: "plugins.tier.optional",
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
  onInstall,
  onOpenDetails,
}: {
  view: PluginView;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
  onInstall: () => void;
  onOpenDetails: () => void;
}) {
  const t = useT();
  const scope = view.scope || "unlisted";
  return (
    // The whole card opens the contents dialog: a "Contents" button beside the
    // switch read as one more control rather than as the way in (T-0244).
    <div
      role="button"
      tabIndex={0}
      aria-label={t("plugins.card.contentsAria", { name: view.name })}
      onClick={onOpenDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
            {TIER_LABEL_KEY[view.tier] ? t(TIER_LABEL_KEY[view.tier]) : t("plugins.tier.unlisted")}
          </Badge>
          <Badge className="text-muted-foreground">{scope}</Badge>
          {view.extra && (
            <Hint label={t("plugins.card.notInCatalogHint")}>
              <Badge className="border-amber-500/50 text-amber-600">
                {t("plugins.card.notInCatalog")}
              </Badge>
            </Hint>
          )}
          <Badge className={STATUS_CLASS[view.status]}>{t(STATUS_LABEL_KEY[view.status])}</Badge>
        </div>
        {view.summary && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{view.summary}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span>{view.installed_version || t("plugins.card.notInstalled")}</span>
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
            ·{" "}
            {view.enabled
              ? t("plugins.card.onScope", { scope: view.effective_scope })
              : t("plugins.card.off")}
          </span>
        </div>
      </div>
      {/* The controls are their own targets: clicking a switch must not also
          open the dialog behind it. */}
      <div
        className="flex shrink-0 items-center gap-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {view.status === "outdated" && (
          <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={onUpdate}>
            {t("plugins.card.update")}
          </Button>
        )}
        {view.status === "pending" && (
          <Hint
            label={`claude plugin install --scope ${view.effective_scope}${t("plugins.card.installHintSuffix")}`}
          >
            <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={onInstall}>
              {t("plugins.card.install")}
            </Button>
          </Hint>
        )}
        <Hint
          label={
            view.enabled
              ? t("plugins.card.disableHint", { scope: view.effective_scope })
              : view.installed_version
                ? t("plugins.card.enableHint", { scope: view.effective_scope })
                : t("plugins.card.installEnableHint", { scope: view.effective_scope })
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
  const t = useT();
  const [state, setState] = useState<PluginsState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PluginCommandResult | null>(null);
  /** The plugin whose contents are being read; null keeps the dialog closed. */
  const [details, setDetails] = useState<PluginView | null>(null);
  /**
   * The marketplace currently being updated, so the spinner sits on the button
   * that is actually running. Every button is disabled while one runs — two
   * concurrent `claude plugin` invocations would race on the same state — but
   * disabling alone never said which one the app was working on.
   */
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState(await api.pluginsState(vaultPath));
    setLoaded(true);
  }, [vaultPath]);

  useEffect(() => {
    if (active) void load().catch((e) => setError(String(e)));
  }, [active, load]);

  const views = useMemo(() => (state ? pluginViews(state) : []), [state]);
  /** The workhub marketplace's own rows — the only ones a catalog judges. */
  const owned = useMemo(
    () => (state ? pluginsOfMarketplace(views, state.marketplace) : []),
    [views, state],
  );
  /** Every other registered marketplace, with the rows it contributed. */
  const others = useMemo(() => {
    const list = (state?.marketplaces ?? []).filter((m) => m.name !== state?.marketplace);
    return list
      .map((info) => ({ info, rows: pluginsOfMarketplace(views, info.name) }))
      // A registered marketplace nothing is installed from is not worth a
      // heading: it says only that the owner once ran `marketplace add`.
      .filter((group) => group.rows.length > 0);
  }, [views, state]);
  const otherCount = others.reduce((n, g) => n + g.rows.length, 0);

  const problems = useMemo(() => pluginProblems(owned), [owned]);
  const suggestions = useMemo(() => pluginSuggestions(owned), [owned]);
  const missing = problems.filter((p) => p.status === "missing");
  const outdated = problems.filter((p) => p.status === "outdated");
  const home = state?.marketplaces.find((m) => m.name === state.marketplace);

  /** Every action ends by re-reading the state, so the list never lies. */
  const run = async (action: () => Promise<PluginCommandResult | PluginsState | void>) => {
    setBusy(true);
    setError(null);
    try {
      const out = await action();
      if (out && "command" in out) {
        setResult(out);
        if (!out.ok) setError(i18nT("plugins.view.commandFailed", { command: out.command }));
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** `claude plugin install` at the scope the row's switch writes to. */
  const install = (view: PluginView) =>
    api.pluginsInstallPlugin(vaultPath, view.name, view.marketplace, view.effective_scope);

  /** One plugin row, wired to the actions. Identical in both tabs. */
  const card = (view: PluginView) => (
    <PluginCard
      key={`${view.marketplace}/${view.name}`}
      view={view}
      busy={busy}
      onToggle={(enabled) =>
        void run(() =>
          // Switching on a plugin that is on disk nowhere installs it right
          // away: a settings edit alone left the fetch to the next Claude Code
          // launch, and the contents unreadable until then (T-0397).
          enabled && !view.installed_version
            ? install(view)
            : api.setPluginEnabled(
                vaultPath,
                view.name,
                view.marketplace,
                view.effective_scope,
                enabled,
              ),
        )
      }
      onUpdate={() =>
        void run(() =>
          api.pluginsUpdatePlugin(
            vaultPath,
            view.name,
            view.marketplace,
            view.effective_scope,
          ),
        )
      }
      onInstall={() => void run(() => install(view))}
      onOpenDetails={() => setDetails(view)}
    />
  );

  /** Every marketplace whose clone is on disk — the ones an update can reach. */
  const updatable = useMemo(
    () => (state?.marketplaces ?? []).filter((m) => m.clone_found).map((m) => m.name),
    [state],
  );

  /**
   * Update the named marketplaces one after another.
   *
   * Sequential rather than parallel: each one shells out to `claude plugin`,
   * and the button naming the marketplace in flight is only honest if there is
   * exactly one. The results are reported together so a failure in the middle
   * of a bulk run is not hidden by the last success.
   */
  const updateMarketplaces = async (names: string[]) => {
    if (names.length === 0) return;
    setBusy(true);
    setError(null);
    const results: PluginCommandResult[] = [];
    try {
      for (const name of names) {
        setUpdating(name);
        results.push(await api.pluginsUpdateMarketplace(vaultPath, name));
      }
      setResult(
        results.length === 1
          ? results[0]
          : {
              command: t("plugins.view.bulkUpdateCommand", { count: names.length }),
              ok: results.every((r) => r.ok),
              output: results
                .map(
                  (r) =>
                    [
                      `$ ${r.command}`,
                      r.output ||
                        (r.ok
                          ? t("plugins.view.resultDone")
                          : t("plugins.view.resultFailedNoOutput")),
                    ].join('\n'),
                )
                .join('\n\n'),
            },
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(
          failed.length === 1
            ? t("plugins.view.commandFailed", { command: failed[0].command })
            : t(
                failed.length === 1
                  ? "plugins.view.someMarketplaceUpdatesFailedOne"
                  : "plugins.view.someMarketplaceUpdatesFailedOther",
                { count: failed.length, total: results.length },
              ),
        );
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setUpdating(null);
      setBusy(false);
    }
  };

  /** Updates one marketplace; the label names it so the button reads alone. */
  const updateMarketplaceButton = (name: string) => (
    <Hint label={`claude plugin marketplace update ${name}`}>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={busy}
        onClick={() => void updateMarketplaces([name])}
      >
        {updating === name ? (
          <>
            <RefreshCw className="size-3.5 animate-spin" />
            {t("plugins.view.updatingName", { name })}
          </>
        ) : (
          t("plugins.view.updateName", { name })
        )}
      </Button>
    </Hint>
  );

  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">{t("plugins.view.loading")}</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Puzzle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-sm font-medium">{t("plugins.view.title")}</h2>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("plugins.view.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {updatable.length > 1 && (
              <Hint label={`claude plugin marketplace update — ${updatable.join(", ")}`}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={busy}
                  onClick={() => void updateMarketplaces(updatable)}
                >
                  {updating ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      {t("plugins.view.updatingName", { name: updating })}
                    </>
                  ) : (
                    t("plugins.view.updateAllMarketplaces")
                  )}
                </Button>
              </Hint>
            )}
            <Hint label={t("plugins.view.rereadHint")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                disabled={busy}
                onClick={() => void run(load)}
              >
                <RefreshCw className={cn("size-3.5", busy && !updating && "animate-spin")} />
              </Button>
            </Hint>
          </div>
        </div>

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <Tabs defaultValue="workhub">
          <TabsList>
            <TabsTrigger value="workhub">
              {state?.marketplace}
              <span className="ml-1.5 text-muted-foreground">· {owned.length}</span>
            </TabsTrigger>
            <TabsTrigger value="others">
              {t("plugins.view.otherMarketplaces")}
              <span className="ml-1.5 text-muted-foreground">· {otherCount}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workhub" className="space-y-4 pt-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("plugins.view.workhubTabDescription")}
              </p>
              {updateMarketplaceButton(state?.marketplace ?? "")}
            </div>

            {!home?.clone_found && (
              <Warning>
                {t("plugins.view.notClonedWarningPrefix")}{" "}
                <code>claude plugin marketplace add atman-33/workhub</code>.
              </Warning>
            )}

            {home?.clone_found && !home.catalog_found && (
              <Warning>
                {t("plugins.view.noCatalogWarningPrefix")}{" "}
                <code>.claude-plugin/catalog.json</code>
                {t("plugins.view.noCatalogWarningSuffix")}
              </Warning>
            )}

            {missing.length > 0 && (
              <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                <p className="leading-relaxed">
                  <span className="font-medium">
                    {t(
                      missing.length === 1
                        ? "plugins.view.missingPluginsOne"
                        : "plugins.view.missingPluginsOther",
                      { count: missing.length },
                    )}
                  </span>{" "}
                  {t("plugins.view.missingPluginsDetail", {
                    names: missing.map((m) => m.name).join(", "),
                  })}
                </p>
              </div>
            )}

            {outdated.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  outdated.length === 1
                    ? "plugins.view.outdatedPluginsOne"
                    : "plugins.view.outdatedPluginsOther",
                  { count: outdated.length },
                )}
              </p>
            )}

            {suggestions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  suggestions.length === 1
                    ? "plugins.view.suggestedPluginsOne"
                    : "plugins.view.suggestedPluginsOther",
                  { count: suggestions.length, names: suggestions.map((s) => s.name).join(", ") },
                )}
              </p>
            )}

            <div className="space-y-2">{owned.map(card)}</div>
          </TabsContent>

          <TabsContent value="others" className="space-y-6 pt-4">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("plugins.view.othersTabDescriptionPrefix")} <code>claude plugin</code>
              {t("plugins.view.othersTabDescriptionSuffix")}
            </p>

            {others.length === 0 ? (
              <p className="rounded border p-3 text-xs leading-relaxed text-muted-foreground">
                {t("plugins.view.othersEmpty")}
              </p>
            ) : (
              others.map(({ info, rows }) => (
                <div key={info.name} className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <MarketplaceHeading info={info} count={rows.length} />
                    {info.clone_found && updateMarketplaceButton(info.name)}
                  </div>
                  {!info.clone_found && (
                    <Warning>
                      {info.clone_path
                        ? t("plugins.view.cloneMissingWarning")
                        : t("plugins.view.notRegisteredWarning")}
                    </Warning>
                  )}
                  <div className="space-y-2">{rows.map(card)}</div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>

        {result && (
          <div className="space-y-1 rounded border p-3">
            <p className="font-mono text-[11px] text-muted-foreground">{result.command}</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">
              {result.output ||
                (result.ok ? t("plugins.view.resultDone") : t("plugins.view.resultFailedNoOutput"))}
            </pre>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("plugins.view.footerNotePrefix")}{" "}
          <code>{state?.project_settings_path || t("plugins.view.vaultSettingsFallback")}</code>{" "}
          {t("plugins.view.footerNoteMid")} <code>{state?.user_settings_path}</code>{" "}
          {t("plugins.view.footerNoteSuffix")}
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

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

/** One marketplace's heading in the "other marketplaces" tab. */
function MarketplaceHeading({ info, count }: { info: MarketplaceInfo; count: number }) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-0.5">
      <h3 className="text-xs font-medium">
        {info.name}
        <span className="ml-1.5 font-normal text-muted-foreground">· {count}</span>
      </h3>
      {info.marketplace_updated && (
        <p className="font-mono text-[10px] text-muted-foreground">
          {t("plugins.view.marketplaceCloneRefreshed", {
            date: info.marketplace_updated.slice(0, 10),
          })}
        </p>
      )}
    </div>
  );
}
