import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Task } from "@/types";

interface Props {
  /** The task being blocked/edited; null closes the dialog. */
  task: Task | null;
  /** Saves the reason. Blocking is implied — the caller sends `blocked: true`. */
  onSave: (task: Task, note: string) => void;
  onClose: () => void;
}

/**
 * One field, one question: what is this task waiting on?
 *
 * Reaching the full editor to record that took too many steps, and the answer
 * is usually a handful of words. The date is deliberately absent — a new block
 * starts today, which is right nearly always, and the rare correction can be
 * made in the task editor.
 */
export function BlockedDialog({ task, onSave, onClose }: Props) {
  const [note, setNote] = useState("");
  const wasBlocked = task?.blocked ?? false;

  // Re-seed each time a different task opens the dialog.
  useEffect(() => {
    if (task) setNote(task.blocked_note);
  }, [task]);

  const save = () => {
    if (!task) return;
    onSave(task, note.trim());
    onClose();
  };

  return (
    <Dialog open={task !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{wasBlocked ? "Edit blocked reason" : "Mark as blocked"}</DialogTitle>
          <DialogDescription>
            {wasBlocked
              ? "What is this task waiting on?"
              : "What is this task waiting on? The wait is counted from today."}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder="e.g. vendor quote, review from Sato"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>{wasBlocked ? "Save" : "Mark as blocked"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
