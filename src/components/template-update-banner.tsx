import { useEffect, useState } from "react";
import { AlertTriangle, Check, FileDiff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { diffLineClass } from "@/lib/diff-format";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TemplateDiff, TemplateFileState } from "@/types";

interface Props {
  diff: TemplateDiff;
  vaultPath: string;
  onDismiss: () => void;
  /** Called after a successful apply so the caller can re-check the diff. */
  onApplied: () => void;
}

const STATE_LABEL_KEY: Record<TemplateFileState, MessageKey> = {
  added: "template.state.added",
  updatable: "template.state.update",
  conflict: "template.state.conflict",
  up_to_date: "template.state.upToDate",
};

const STATE_VARIANT: Record<TemplateFileState, "secondary" | "outline" | "destructive"> = {
  added: "secondary",
  updatable: "secondary",
  conflict: "destructive",
  up_to_date: "outline",
};

function isPending(state: TemplateFileState): boolean {
  return state !== "up_to_date";
}

/** Quiet note that safe template updates were applied on startup without
 * asking (T-0196). It reports rather than asks — everything it lists was
 * either missing from the vault or byte-identical to the last applied
 * template, so nothing the user wrote could have been lost. */
export function TemplateAutoAppliedBanner({
  paths,
  onDismiss,
}: {
  paths: string[];
  onDismiss: () => void;
}) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="border-b bg-muted/40 px-4 py-1.5 text-[13px] text-muted-foreground">
      <div className="flex h-7 items-center gap-3">
        <Check className="size-4 shrink-0" />
        <span>
          {paths.length === 1
            ? t("template.autoApplied.updatedOne")
            : t("template.autoApplied.updatedOther", { count: paths.length })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => setDetailsOpen((o) => !o)}
        >
          {detailsOpen ? t("template.autoApplied.hide") : t("template.autoApplied.details")}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onDismiss}>
          {t("common.dismiss")}
        </Button>
      </div>
      {detailsOpen && (
        <ul className="max-h-40 overflow-y-auto pb-1.5 pl-7 font-mono text-[11px]">
          {paths.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TemplateUpdateBanner({ diff, vaultPath, onDismiss, onApplied }: Props) {
  const t = useT();
  const pending = diff.files.filter((f) => isPending(f.state));
  const removed = diff.removed ?? [];
  const [reviewOpen, setReviewOpen] = useState(false);

  // Leftovers count towards the banner: a vault whose only finding is a file
  // the template dropped still has something to show the owner.
  const findings = pending.length + removed.length;
  if (findings === 0) return null;

  return (
    <>
      <div className="flex h-10 items-center gap-3 bg-primary px-4 text-[13px] text-primary-foreground">
        <FileDiff className="size-4 shrink-0" />
        <span className="font-medium">
          {findings === 1
            ? t("template.update.findingsOne")
            : t("template.update.findingsOther", { count: findings })}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-xs"
          onClick={() => setReviewOpen(true)}
        >
          {t("template.update.review")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs hover:bg-white/10"
          onClick={onDismiss}
        >
          {t("common.later")}
        </Button>
      </div>
      <TemplateReviewDialog
        open={reviewOpen}
        diff={diff}
        vaultPath={vaultPath}
        onClose={() => setReviewOpen(false)}
        onApplied={() => {
          setReviewOpen(false);
          onApplied();
        }}
      />
    </>
  );
}

interface ReviewProps {
  open: boolean;
  diff: TemplateDiff;
  vaultPath: string;
  onClose: () => void;
  onApplied: () => void;
}

/** How a conflicting file gets resolved when the update is applied. */
type Resolution = "keep" | "overwrite";

function TemplateReviewDialog({ open, diff, vaultPath, onClose, onApplied }: ReviewProps) {
  const t = useT();
  const pending = diff.files.filter((f) => isPending(f.state));
  const removed = diff.removed ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  /** Leftovers the user ticked for deletion. Never pre-filled. */
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      // Default-select added/updatable; leave conflict unselected so a user
      // opts in after reading the explanation (and, if they want, the diff).
      setSelected(
        new Set(pending.filter((f) => f.state !== "conflict").map((f) => f.path)),
      );
      // Conflicts default to keeping the vault's file; replacing is always
      // an explicit per-file choice.
      setOverwrite(new Set());
      // Deleting is never pre-selected, whatever the file is.
      setRemove(new Set());
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (path: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const setResolution = (path: string, resolution: Resolution) => {
    setOverwrite((prev) => {
      const next = new Set(prev);
      if (resolution === "overwrite") next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const toggleRemove = (path: string, checked: boolean) => {
    setRemove((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const apply = async () => {
    setApplying(true);
    setError("");
    try {
      if (selected.size > 0) {
        // Only send overwrite choices for files actually being applied.
        // A checked conflict kept as "Keep mine" advances its baseline, so
        // it stays quiet until the template changes again.
        await api.applyVaultTemplate(
          vaultPath,
          [...selected],
          [...overwrite].filter((p) => selected.has(p)),
        );
      }
      if (remove.size > 0) {
        await api.removeTemplateOrphans(vaultPath, [...remove]);
      }
      onApplied();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  /** Keeps one leftover in place and never offers it for removal again. */
  const retainOne = async (path: string) => {
    setApplying(true);
    setError("");
    try {
      await api.retainTemplateOrphans(vaultPath, [path]);
      onApplied();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  /** Applies everything pending at once: all added/updatable files, all
   * conflicts overwritten (prior content saved as `.bak`), and all
   * leftovers removed. Runs only after the confirmation dialog. */
  const updateAll = async () => {
    setApplying(true);
    setError("");
    try {
      if (pending.length > 0) {
        await api.applyVaultTemplate(
          vaultPath,
          pending.map((f) => f.path),
          pending.filter((f) => f.state === "conflict").map((f) => f.path),
        );
      }
      if (removed.length > 0) {
        await api.removeTemplateOrphans(
          vaultPath,
          removed.map((r) => r.path),
        );
      }
      onApplied();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
      setConfirmAllOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("template.update.title")}</DialogTitle>
          <DialogDescription>{t("template.update.description")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 max-h-[50vh] space-y-2 overflow-y-auto px-6">
          {pending.map((f) => (
            <div key={f.path} className="space-y-1 rounded-md border p-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.has(f.path)}
                  onCheckedChange={(v) => toggle(f.path, v === true)}
                />
                <span className="flex-1 truncate font-mono text-xs">{f.path}</span>
                <Badge variant={STATE_VARIANT[f.state]}>{t(STATE_LABEL_KEY[f.state])}</Badge>
              </label>
              {f.state === "conflict" && (
                <div className="ml-6 space-y-1.5">
                  <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    {t("template.update.conflictWarning")}
                  </p>
                  <ResolutionPicker
                    path={f.path}
                    value={overwrite.has(f.path) ? "overwrite" : "keep"}
                    onChange={(r) => setResolution(f.path, r)}
                  />
                </div>
              )}
              <DiffPreview vaultPath={vaultPath} path={f.path} />
            </div>
          ))}
          {removed.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="space-y-1">
                <p className="text-xs font-medium">{t("template.update.removedTitle")}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t("template.update.removedDescription")}
                </p>
              </div>
              {removed.map((r) => (
                <div
                  key={r.path}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <label className="flex flex-1 items-center gap-2">
                    <Checkbox
                      checked={remove.has(r.path)}
                      onCheckedChange={(v) => toggleRemove(r.path, v === true)}
                    />
                    <span className="flex-1 truncate font-mono text-xs">{r.path}</span>
                    <Badge variant="outline">{t("template.update.removeBadge")}</Badge>
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-[11px] text-muted-foreground"
                    disabled={applying}
                    onClick={() => void retainOne(r.path)}
                  >
                    {t("template.update.keep")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setConfirmAllOpen(true)}
            disabled={applying || pending.length + removed.length === 0}
          >
            {t("template.update.updateAll")}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={applying || selected.size + remove.size === 0}
          >
            {applying && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {applying ? t("template.update.updating") : t("template.update.apply")}
          </Button>
        </DialogFooter>
        <ConfirmDialog
          open={confirmAllOpen}
          title={t("template.update.confirmTitle")}
          description={t("template.update.confirmDescription")}
          confirmLabel={t("template.update.confirmLabel")}
          destructive
          onConfirm={() => void updateAll()}
          onClose={() => setConfirmAllOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const RESOLUTION_LABEL_KEY: Record<Resolution, MessageKey> = {
  keep: "template.update.resolutionKeep",
  overwrite: "template.update.resolutionOverwrite",
};

/** Segmented two-button control choosing how one conflict is resolved. */
function ResolutionPicker({
  path,
  value,
  onChange,
}: {
  path: string;
  value: Resolution;
  onChange: (resolution: Resolution) => void;
}) {
  const t = useT();
  return (
    <div
      className="flex gap-1"
      role="radiogroup"
      aria-label={t("template.update.resolutionAria", { path })}
    >
      {(["keep", "overwrite"] as const).map((r) => (
        <Button
          key={r}
          role="radio"
          aria-checked={value === r}
          size="sm"
          variant={value === r ? "secondary" : "ghost"}
          className={cn(
            "h-6 px-2 text-[11px]",
            value === r && r === "overwrite" && "text-destructive",
          )}
          onClick={() => onChange(r)}
        >
          {t(RESOLUTION_LABEL_KEY[r])}
        </Button>
      ))}
    </div>
  );
}

/** Collapsed "Show diff" toggle that lazily loads the vault-vs-template
 * unified diff for one path — the context a user needs before deciding to
 * discard their own edits. */
function DiffPreview({ vaultPath, path }: { vaultPath: string; path: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || diff !== null) return;
    let cancelled = false;
    setLoading(true);
    void api
      .previewVaultTemplateFile(vaultPath, path)
      .then((text) => {
        if (!cancelled) setDiff(text);
      })
      .catch((e) => {
        if (!cancelled) setDiff(t("template.update.diffFailed", { error: String(e) }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, diff, vaultPath, path]);

  return (
    <div className="ml-6">
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px] text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? t("template.update.hideDiff") : t("template.update.showDiff")}
      </Button>
      {open && (
        <div className="mt-1 max-h-56 overflow-auto rounded-md border bg-muted/30 p-2">
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {diff !== null && (
            <pre className="font-mono text-[11px] leading-4">
              {diff.split("\n").map((line, i) => (
                <div key={i} className={diffLineClass(line)}>
                  {line || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
