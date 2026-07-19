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

function TemplateReviewDialog({ open, diff, vaultPath, onClose, onApplied }: ReviewProps) {
  const pending = diff.files.filter((f) => isPending(f.state));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      // Default-select added/updatable; leave conflict unselected so a user
      // opts in to overwriting after reading the .new-file explanation.
      setSelected(
        new Set(pending.filter((f) => f.state !== "conflict").map((f) => f.path)),
      );
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

  const apply = async () => {
    setApplying(true);
    setError("");
    try {
      await api.applyVaultTemplate(vaultPath, [...selected]);
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
                <p className="ml-6 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  You edited this file and the template also changed it. Updating writes{" "}
                  <span className="font-mono">{f.path}.new</span> beside the original instead
                  of overwriting it — merge by hand afterward.
                </p>
              )}
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
