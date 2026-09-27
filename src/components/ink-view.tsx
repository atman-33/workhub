// Ink tab: the screen captures Alt+C writes, plus the settings for the
// annotation feature itself.
//
// The enable switch and the destination folder sit here rather than in the
// Settings dialog for the same reason the clips gesture does (see
// clips-view.tsx): they are configured rarely and in one sitting, and keeping
// them next to the thing they configure saves hunting in two places. The
// shared input-listener panel stays in Settings — it belongs to the keyboard
// listener that Clips uses too, not to this feature.
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Copy, FolderOpen, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Config, InkCapture } from "@/types";

/** Explicit locale: the Windows display language must not decide this. */
const STAMP = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CaptureCard({
  capture,
  onOpen,
  onCopy,
  onReveal,
  onDelete,
}: {
  capture: InkCapture;
  onOpen: () => void;
  onCopy: () => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div className="group relative overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full cursor-zoom-in bg-muted/40"
        aria-label={t("ink.card.openAria", { name: capture.name })}
      >
        <img
          src={capture.thumbnail}
          alt={capture.name}
          className="h-32 w-full object-cover object-top"
        />
      </button>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs">{capture.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {STAMP.format(new Date(capture.modified_ms))} · {capture.width}×{capture.height} ·{" "}
            {formatSize(capture.size_bytes)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="icon-xs" variant="ghost" onClick={onCopy} aria-label={t("ink.card.copyAria")}>
            <Copy />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={onReveal} aria-label={t("ink.card.revealAria")}>
            <FolderOpen />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={onDelete} aria-label={t("ink.card.deleteAria")}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InkView({ configVersion }: { configVersion: number }) {
  const t = useT();
  const [captures, setCaptures] = useState<InkCapture[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [dir, setDir] = useState("");
  // The resolved folder, which is what the "Open folder" button acts on — the
  // configured value is usually empty (= the vault's attachments/ink/).
  const [resolvedDir, setResolvedDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<InkCapture | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [list, resolved] = await Promise.all([api.listInkCaptures(), api.inkCaptureDir()]);
      setCaptures(list);
      setResolvedDir(resolved);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const cfg = await api.getConfig();
      setConfig(cfg);
      setDir(cfg.settings.ink_dir);
      await refresh();
    })();
  }, [configVersion, refresh]);

  // Captures change outside this window — Alt+C saves in the overlay, crops
  // and their saves in the preview window — and the backend announces every
  // change, so the list follows along instead of waiting for a manual refresh.
  useEffect(() => {
    const unlisten = listen("ink://captures-changed", () => void refresh());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  /** Feature settings save immediately — there is nothing to review. The
   * patch goes onto a fresh read of the config, so a setting another tab
   * saved meanwhile is not reverted. */
  const patchSettings = useCallback(
    async (patch: Partial<Config["settings"]>) => {
      setConfig((c) => (c ? { ...c, settings: { ...c.settings, ...patch } } : c));
      try {
        setConfig(await api.patchSettings(patch));
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const copy = async (capture: InkCapture) => {
    try {
      await api.copyInkCapture(capture.path);
    } catch (e) {
      setError(String(e));
    }
  };

  /** Opens the capture in the floating preview window (move/resize/crop). */
  const openPreview = async (capture: InkCapture) => {
    setError("");
    try {
      await api.openInkPreview(capture.path);
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await api.deleteInkCapture(target.path);
      setCaptures((prev) => prev.filter((c) => c.path !== target.path));
    } catch (e) {
      setError(String(e));
    }
  };

  const enabled = config?.settings.ink_enabled ?? true;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-2">
        <Pencil className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{t("ink.header.title")}</h2>
        <span className="truncate text-xs text-muted-foreground">
          {t("ink.header.subtitle")}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0"
          onClick={() => void refresh()}
        >
          <RefreshCw />
          {t("ink.header.refresh")}
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border p-3">
        <Switch
          checked={enabled}
          disabled={!config}
          onCheckedChange={(v) => void patchSettings({ ink_enabled: v })}
        />
        <span className="text-xs">{t("ink.settings.enable")}</span>
        <div className="flex min-w-[18rem] flex-1 items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">{t("ink.settings.saveTo")}</span>
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onBlur={() => {
              if (config && dir !== config.settings.ink_dir) void patchSettings({ ink_dir: dir });
            }}
            placeholder={t("ink.settings.dirPlaceholder")}
            className="h-8 font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={!resolvedDir}
            onClick={() => void api.openExplorer(resolvedDir)}
          >
            <FolderOpen />
            {t("ink.settings.openFolder")}
          </Button>
        </div>
      </div>

      {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-muted-foreground">{t("ink.view.loading")}</p>
        ) : captures.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-xs text-muted-foreground">
            <p>{t("ink.view.emptyTitle")}</p>
            <p className="mt-1">
              {t("ink.view.emptyBody", { alt: "Alt", c: "C", dir: resolvedDir })}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {captures.map((capture) => (
              <CaptureCard
                key={capture.path}
                capture={capture}
                onOpen={() => void openPreview(capture)}
                onCopy={() => void copy(capture)}
                onReveal={() => void api.openExplorer(capture.path)}
                onDelete={() => setPendingDelete(capture)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t("ink.delete.title")}
        description={t("ink.delete.description", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("ink.delete.confirm")}
        destructive
        onConfirm={() => void remove()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
