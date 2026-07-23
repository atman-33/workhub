import { useEffect, useState } from "react";
import { AlertTriangle, FileDiff, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { TemplateDiff, TemplateFileState } from "@/types";

interface Props {
  diff: TemplateDiff;
  vaultPath: string;
  onDismiss: () => void;
  /** Called after a successful apply so the caller can re-check the diff. */
  onApplied: () => void;
}

const STATE_LABEL: Record<TemplateFileState, string> = {
  added: "added",
  updatable: "update",
  conflict: "conflict",
  up_to_date: "up to date",
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

export function TemplateUpdateBanner({ diff, vaultPath, onDismiss, onApplied }: Props) {
  const pending = diff.files.filter((f) => isPending(f.state));
  const [reviewOpen, setReviewOpen] = useState(false);

  if (pending.length === 0) return null;

  return (
    <>
      <div className="flex h-10 items-center gap-3 bg-primary px-4 text-[13px] text-primary-foreground">
        <FileDiff className="size-4 shrink-0" />
        <span className="font-medium">
          Vault template has {pending.length} update{pending.length === 1 ? "" : "s"}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-xs"
          onClick={() => setReviewOpen(true)}
        >
          Review
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs hover:bg-white/10"
          onClick={onDismiss}
        >
          Later
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
  const pending = diff.files.filter((f) => isPending(f.state));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      // Default-select added/updatable; leave conflict unselected so a user
      // opts in after reading the explanation (and, if they want, the diff).
      setSelected(
        new Set(pending.filter((f) => f.state !== "conflict").map((f) => f.path)),
      );
      // Conflicts default to the non-destructive resolution (.new beside the
      // original); replacing is always an explicit per-file choice.
      setOverwrite(new Set());
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

  const apply = async () => {
    setApplying(true);
    setError("");
    try {
      // Only send overwrite choices for files actually being applied.
      await api.applyVaultTemplate(
        vaultPath,
        [...selected],
        [...overwrite].filter((p) => selected.has(p)),
      );
      onApplied();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vault template updates</DialogTitle>
          <DialogDescription>
            Choose which files to update from the bundled vault template.
          </DialogDescription>
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
                <Badge variant={STATE_VARIANT[f.state]}>{STATE_LABEL[f.state]}</Badge>
              </label>
              {f.state === "conflict" && (
                <div className="ml-6 space-y-1.5">
                  <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    You edited this file and the template also changed it. Choose how to
                    resolve it — check the diff first if you are unsure what your copy
                    contains.
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
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={applying || selected.size === 0}>
            {applying && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {applying ? "Updating…" : "Update selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const RESOLUTION_LABEL: Record<Resolution, string> = {
  keep: "Keep mine (write .new)",
  overwrite: "Replace with template",
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
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={`Resolution for ${path}`}>
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
          {RESOLUTION_LABEL[r]}
        </Button>
      ))}
    </div>
  );
}

/** Collapsed "Show diff" toggle that lazily loads the vault-vs-template
 * unified diff for one path — the context a user needs before deciding to
 * discard their own edits. */
function DiffPreview({ vaultPath, path }: { vaultPath: string; path: string }) {
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
        if (!cancelled) setDiff(`diff failed — ${e}`);
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
        {open ? "Hide diff" : "Show diff"}
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
