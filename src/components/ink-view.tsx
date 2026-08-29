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
import { Copy, FolderOpen, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { InkCaptureDialog } from "@/components/ink-capture-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
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
  return (
    <div className="group relative overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full cursor-zoom-in bg-muted/40"
        aria-label={`Open ${capture.name}`}
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
          <Button size="icon-xs" variant="ghost" onClick={onCopy} aria-label="Copy to clipboard">
            <Copy />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={onReveal} aria-label="Show in Explorer">
            <FolderOpen />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={onDelete} aria-label="Delete">
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InkView({ configVersion }: { configVersion: number }) {
  const [captures, setCaptures] = useState<InkCapture[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [dir, setDir] = useState("");
  // The resolved folder, which is what the "Open folder" button acts on — the
  // configured value is usually empty (= the vault's attachments/ink/).
  const [resolvedDir, setResolvedDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<InkCapture | null>(null);
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

  /** Feature settings save immediately — there is nothing to review. */
  const patchSettings = useCallback(
    async (patch: Partial<Config["settings"]>) => {
      if (!config) return;
      const next = { ...config, settings: { ...config.settings, ...patch } };
      setConfig(next);
      try {
        await api.saveConfig(next);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [config, refresh],
  );

  const copy = async (capture: InkCapture) => {
    try {
      await api.copyInkCapture(capture.path);
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
        <h2 className="text-sm font-medium">Ink</h2>
        <span className="truncate text-xs text-muted-foreground">
          Draw on screen with a double-press of Alt; Alt+C saves the shot and copies it
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0"
          onClick={() => void refresh()}
        >
          <RefreshCw />
          Refresh
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border p-3">
        <Switch
          checked={enabled}
          disabled={!config}
          onCheckedChange={(v) => void patchSettings({ ink_enabled: v })}
        />
        <span className="text-xs">Enable screen annotation</span>
        <div className="flex min-w-[18rem] flex-1 items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">Save to</span>
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onBlur={() => {
              if (config && dir !== config.settings.ink_dir) void patchSettings({ ink_dir: dir });
            }}
            placeholder="blank = the vault's attachments/ink/"
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
            Open folder
          </Button>
        </div>
      </div>

      {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : captures.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-xs text-muted-foreground">
            <p>No captures yet.</p>
            <p className="mt-1">
              Double-press <span className="font-mono">Alt</span> and hold the second press to draw,
              then press <span className="font-mono">Alt</span> + <span className="font-mono">C</span>{" "}
              to save what is on screen. Captures land in{" "}
              <span className="font-mono">{resolvedDir}</span>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {captures.map((capture) => (
              <CaptureCard
                key={capture.path}
                capture={capture}
                onOpen={() => setPreview(capture)}
                onCopy={() => void copy(capture)}
                onReveal={() => void api.openExplorer(capture.path)}
                onDelete={() => setPendingDelete(capture)}
              />
            ))}
          </div>
        )}
      </div>

      <InkCaptureDialog
        capture={preview}
        onClose={() => setPreview(null)}
        onSaved={() => void refresh()}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete capture?"
        description={`"${pendingDelete?.name ?? ""}" goes to the recycle bin, so it can be restored from there.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
