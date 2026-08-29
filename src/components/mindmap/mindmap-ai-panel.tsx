import { useState } from "react";
import { Loader2, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { Textarea } from "@/components/ui/textarea";
import { timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MindmapEditRun } from "@/types";

/**
 * Natural-language editing of the open mindmap.
 *
 * The panel is a thin shell over the backend runner: it submits an
 * instruction, reflects `mindmap-edit:status`, and offers the undo. It never
 * reads or writes the mindmap file — the agent writes it and the file watcher
 * brings the change back, which is why nothing here has to reconcile the
 * agent's output with what is on screen.
 */

interface Props {
  run: MindmapEditRun;
  /** Whether the confirm-first mode starts on (from Settings). */
  defaultConfirm: boolean;
  disabled?: boolean;
  onRun: (instruction: string, confirm: boolean) => void;
  onUndo: () => void;
}

export function MindmapAiPanel({ run, defaultConfirm, disabled, onRun, onUndo }: Props) {
  const [instruction, setInstruction] = useState("");
  const [confirm, setConfirm] = useState(defaultConfirm);
  const running = run.state === "running";

  const submit = () => {
    if (!instruction.trim() || running || disabled) return;
    onRun(instruction.trim(), confirm);
    setInstruction("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <Sparkles className="size-3.5" />
        Edit with AI
      </div>

      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        // Ctrl+Enter rather than Enter: an instruction is usually a couple of
        // sentences, so plain Enter has to stay a newline.
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={running || disabled}
        rows={4}
        placeholder="e.g. group the UI ideas under a new branch and colour the release branch red"
        className="resize-none text-xs"
      />

      <label className="flex items-center gap-2">
        <Checkbox
          checked={confirm}
          onCheckedChange={(v) => setConfirm(v === true)}
          disabled={running}
        />
        Review the diff before applying
      </label>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={submit}
          disabled={running || disabled}
        >
          {running ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
          {running ? "Running…" : "Run (Ctrl+Enter)"}
        </Button>
        <Hint label="Undo the last AI edit" disabled={running || !run.can_undo}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onUndo}
            disabled={running || !run.can_undo}
          >
            <RotateCcw className="size-3" />
          </Button>
        </Hint>
      </div>

      {running && run.stalled && (
        <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          This is taking a while. The run log is under `_ai/logs/mindmap/`.
        </div>
      )}
      {run.state === "failed" && run.error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px]">
          {run.error}
        </div>
      )}
      {run.state === "completed" && run.summary && (
        <div className="rounded border bg-muted/40 p-2 text-[11px]">{run.summary}</div>
      )}

      {run.history.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">History</div>
          <ul className="space-y-1.5">
            {run.history.map((entry) => (
              <li key={entry.at} className="rounded border p-1.5 text-[11px]">
                <Hint label={entry.instruction}>
                  <div className="truncate">{entry.instruction}</div>
                </Hint>
                <div
                  className={cn(
                    "mt-0.5 text-[10px]",
                    entry.state === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {entry.seconds}s · {timeAgo(entry.at)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
