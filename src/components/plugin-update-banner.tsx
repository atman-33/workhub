import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { WORKHUB_PLUGIN, type PluginAlert } from "@/lib/plugins";

interface Props {
  alert: PluginAlert;
  vaultPath: string;
  /** Switch to the Plugins tab for the full picture and manual fixes. */
  onOpenPlugins: () => void;
  /** Re-read the plugin state after a fix, so the banner clears itself. */
  onResolved: () => void;
  /** Dismiss for this app run only. */
  onDismiss: () => void;
}

/**
 * Startup notice for the workhub plugin (T-0349) — the app-update banner's
 * counterpart for the one plugin the app cannot work without.
 *
 * The Plugins tab already knows all of this, but only once opened; this
 * banner surfaces the two states that need action (switched off, outdated)
 * at startup, plus the unreadable-marketplace case that makes either claim
 * impossible. Fixes run in place — enabling and updating take effect in the
 * next Claude Code session, which the follow-up line says rather than hiding.
 */
export function PluginUpdateBanner({
  alert,
  vaultPath,
  onOpenPlugins,
  onResolved,
  onDismiss,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fix = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onResolved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const enable = () =>
    fix(() => api.setPluginEnabled(vaultPath, WORKHUB_PLUGIN, alert.marketplace, alert.scope, true));

  const update = () =>
    fix(() => api.pluginsUpdatePlugin(vaultPath, WORKHUB_PLUGIN, alert.marketplace, alert.scope));

  return (
    <div className="flex min-h-10 items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-[13px]">
      <AlertTriangle className="size-4 shrink-0 text-amber-600" />
      {alert.kind === "marketplace" && (
        <span className="font-medium">
          The workhub marketplace is not ready, so the plugin version cannot be checked
        </span>
      )}
      {alert.kind === "missing" && (
        <span className="font-medium">
          The workhub plugin is switched off — task launches and AI edits need it
        </span>
      )}
      {alert.kind === "outdated" && (
        <span className="font-medium">
          workhub plugin {alert.installed_version} → {alert.latest_version} is available
        </span>
      )}
      {error ? (
        <span className="truncate text-xs text-destructive">{error}</span>
      ) : (
        <span className="hidden text-xs text-muted-foreground xl:inline">
          Takes effect in the next Claude Code session
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {alert.kind === "missing" && (
          <Button size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={enable}>
            {busy ? "Enabling…" : "Enable"}
          </Button>
        )}
        {alert.kind === "outdated" && (
          <Button size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={update}>
            {busy ? "Updating…" : "Update"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={onOpenPlugins}
        >
          Plugins
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={onDismiss}
        >
          Later
        </Button>
      </span>
    </div>
  );
}
