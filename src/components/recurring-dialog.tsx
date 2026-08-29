import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { api } from "@/lib/api";
import { generateDueTasks } from "@/lib/use-recurring-tasks";
import { RecurringSettings } from "@/components/recurring-settings";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RecurringRule } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after the rules were persisted, so the caller can refresh its copy. */
  onSaved?: (rules: RecurringRule[]) => void;
}

/**
 * Recurring rules editor (T-0110), opened from the Tasks toolbar.
 *
 * The rules are task content rather than an app preference, so they live next
 * to the board they fill instead of in the settings dialog. This component owns
 * the load/save round trip: it reads the rules from the config when it opens and
 * writes only `settings.recurring` back, leaving every other setting alone even
 * if the settings dialog saved something while this was open.
 */
export function RecurringDialog({ open, onClose, onSaved }: Props) {
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setLoading(true);
    void (async () => {
      try {
        const cfg = await api.getConfig();
        setRules(cfg.settings.recurring ?? []);
      } catch (e) {
        setMessage(`Could not load the rules — ${e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  /** Writes the draft rules, leaving the rest of the config as found on disk. */
  const persist = async (next: RecurringRule[]) => {
    const cfg = await api.getConfig();
    await api.saveConfig({ ...cfg, settings: { ...cfg.settings, recurring: next } });
    onSaved?.(next);
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await persist(rules);
      onClose();
    } catch (e) {
      setMessage(`Save failed — ${e}`);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Saves first, then generates: a run reads the rules from disk, so running
   * with unsaved edits on screen would silently use the old ones. Re-reading
   * afterwards picks up the `last_generated` slots the run just consumed, so
   * a later Save cannot reinstate them and fire the same occurrence twice.
   */
  const runNow = async () => {
    setRunning(true);
    setMessage("");
    try {
      await persist(rules);
      const result = await generateDueTasks();
      const cfg = await api.getConfig();
      setRules(cfg.settings.recurring ?? []);
      const parts: string[] = [];
      if (result.created.length) parts.push(`created ${result.created.length}`);
      if (result.skipped.length) parts.push(`skipped ${result.skipped.length} (still open)`);
      setMessage(parts.length ? parts.join(", ") : "Nothing due right now.");
    } catch (e) {
      setMessage(`Run failed — ${e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Recurring tasks</DialogTitle>
          <DialogDescription>
            Rules that put a task on the board on their own schedule.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 h-[min(70vh,560px)] overflow-y-auto px-6 pb-4">
          {loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : (
            <RecurringSettings rules={rules} onChange={setRules} open={open} />
          )}
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
        <DialogFooter className="sm:justify-between">
          <Hint
            label="Save the rules, then create whatever is due right now"
            disabled={running || saving || rules.length === 0}
          >
            <Button
              type="button"
              variant="outline"
              disabled={running || saving || rules.length === 0}
              onClick={() => void runNow()}
            >
              {running ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 size-3.5" />
              )}
              Run now
            </Button>
          </Hint>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={saving || loading} onClick={() => void save()}>
              {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
