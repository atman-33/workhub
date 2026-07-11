import type { TaskStatus } from "@/types";

function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Text-color class for a task's due date: red when overdue, amber when due
 * today, muted otherwise. Done tasks are always muted — a past due date on a
 * finished task is not actionable.
 */
export function dueTone(due: string, status: TaskStatus): string {
  if (!due || status === "done") return "text-muted-foreground";
  const today = todayString();
  if (due < today) return "text-red-400";
  if (due === today) return "text-amber-400";
  return "text-muted-foreground";
}
