import type { Task, TaskPriority } from "@/types";

/**
 * Background tint for a task card or row.
 *
 * Priority is an ordered scale, so the tint is centred on its default rather
 * than stacked upwards: `medium` is the plain background, `low` sinks slightly
 * into grey, `high` lifts into red. Tinting `medium` too would colour most of
 * the board — it is the value tasks get when nobody chose one — and a colour
 * that is everywhere says nothing.
 *
 * Keeping high the only hue also leaves amber free for the toolbar's stale-
 * block dot, which would otherwise be speaking priority's language.
 */
const priorityTint: Record<TaskPriority, string> = {
  low: "bg-muted/40",
  medium: "",
  high: "bg-red-500/10",
};

/**
 * Tint for a task, or "" when it should stay plain. Finished and archived
 * tasks are never tinted: a done `high` glowing red would make the one thing
 * that needs no attention the loudest thing on the board.
 */
export function priorityTintClass(task: Task): string {
  if (task.archived || task.status === "done") return "";
  return priorityTint[task.priority] ?? "";
}
