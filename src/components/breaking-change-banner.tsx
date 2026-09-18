import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AlertTriangle } from "lucide-react";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/lib/api";
import { unmetRequirements } from "@/lib/notices";
import type { Notice } from "@/types";

interface Props {
  notice: Notice;
  vaultPath: string;
  /**
   * Installed version of each plugin the notice may require, so the action can
   * be held back when the skill it names is not on this machine yet. Empty
   * string for a plugin whose version could not be read.
   */
  pluginVersions: Record<string, string>;
  /** Switch to the Plugins tab, when the requirement is what is blocking. */
  onOpenPlugins: () => void;
  /** Filed the task — the caller shows it. */
  onFiled: (taskId: string) => void;
  /** Mark as dealt with: this notice never comes back for this vault. */
  onMarkRead: (id: string) => Promise<unknown>;
  /** Dismiss for this app run only. */
  onDismiss: () => void;
}

/**
 * Startup notice for a change that has already broken this vault (T-0377).
 *
 * Unlike the banners beside it, this one is not about something available or
 * out of date — it is about damage that has already happened and is invisible
 * from inside the app. The hooks that read the vault's old layout fail by
 * exiting quietly, so nothing else will ever mention it.
 *
 * Which is why `breaking` cannot be dismissed permanently from the banner:
 * "Later" lasts until the next launch, and only "Mark as done" stops it, after
 * the dialog has said what the change was. A warning that can be swatted away
 * gets swatted away.
 *
 * The first action files a **task**, not a copied prompt. workhub is a task
 * board: a task carries the launch prompt, the model, the worktree flag and a
 * `## Results` section, so afterwards there is a record of whether the
 * migration happened at all. A prompt pasted into a terminal leaves nothing.
 * Copying stays as the second button, for an agent that is not launched from
 * here.
 */
export function BreakingChangeBanner({
  notice,
  vaultPath,
  pluginVersions,
  onOpenPlugins,
  onFiled,
  onMarkRead,
  onDismiss,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filed, setFiled] = useState("");

  const blockers = unmetRequirements(notice, pluginVersions);
  const blocked = blockers.length > 0;

  // A `breaking` notice describes damage already done, so dismissing it only
  // lasts until the next launch — nothing else in the app will ever mention
  // the problem again, and a warning that can be swatted away gets swatted
  // away. Anything else is ordinary news: dismissing it means "read".
  const permanent = notice.severity !== "breaking";
  const dismiss = permanent ? () => void onMarkRead(notice.id) : onDismiss;

  const fileTask = async () => {
    setBusy(true);
    setError("");
    try {
      const task = await api.createTask(vaultPath, {
        title: notice.action.title,
        status: "todo",
        assignee: "claude-code",
        priority: "high",
        confirm: true,
        project: notice.action.project || undefined,
        body: `## Description\n\n${notice.action.body}\n`,
      });
      setFiled(task.id);
      onFiled(task.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const markRead = async () => {
    setBusy(true);
    setError("");
    try {
      await onMarkRead(notice.id);
      setOpen(false);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex min-h-10 items-center gap-3 border-b border-red-500/40 bg-red-500/10 px-4 py-1.5 text-[13px]">
        <AlertTriangle className="size-4 shrink-0 text-red-600" />
        <span className="font-medium">{notice.title}</span>
        <span className="hidden truncate text-xs text-muted-foreground lg:inline">
          {filed ? `Filed ${filed} — open it from the board` : notice.summary}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
            What changed
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={dismiss}
          >
            {permanent ? "Dismiss" : "Later"}
          </Button>
        </span>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{notice.title}</DialogTitle>
            <DialogDescription>Introduced in workhub {notice.since}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] overflow-y-auto pr-1 text-sm">
            <Markdown>{notice.body}</Markdown>
          </div>

          {blocked && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              The migration lives in a plugin this machine does not have yet:{" "}
              <span className="font-medium">{blockers.join(", ")}</span>. Update it first —
              filing the task now would point an agent at a skill that is not there.
            </p>
          )}

          {filed && (
            <p className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs">
              Filed <span className="font-medium">{filed}</span>. Launch it from the task board;
              it asks for your approval before it moves anything.
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={markRead}
              title="Stop showing this for this vault"
            >
              Mark as done
            </Button>
            <span className="flex items-center gap-2">
              <CopyPromptButton
                showLabel
                size="sm"
                variant="outline"
                label="Copy prompt"
                disabled={blocked}
                onCopy={() => writeText(notice.action.body)}
              />
              <Button size="sm" disabled={busy || blocked || Boolean(filed)} onClick={fileTask}>
                {busy ? "Filing…" : "Create task"}
              </Button>
              {blocked && (
                <Button size="sm" variant="outline" onClick={onOpenPlugins}>
                  Plugins
                </Button>
              )}
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
