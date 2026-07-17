import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/types";

const PRIORITY_ORDER: TaskPriority[] = ["low", "medium", "high"];

/** Next priority in the low → medium → high → low cycle. */
export function nextPriority(priority: TaskPriority): TaskPriority {
  const i = PRIORITY_ORDER.indexOf(priority);
  return PRIORITY_ORDER[(i + 1) % PRIORITY_ORDER.length];
}

// Dark-only app: each level gets a distinct hue plus a leading dot so the
// three steps read at a glance (low = muted, medium = amber, high = red).
const priorityStyle: Record<TaskPriority, { badge: string; dot: string }> = {
  low: {
    badge: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
  medium: {
    badge: "border-amber-500/30 bg-amber-500/15 text-amber-400",
    dot: "bg-amber-400",
  },
  high: {
    badge: "border-red-500/30 bg-red-500/15 text-red-400",
    dot: "bg-red-400",
  },
};

interface Props {
  priority: TaskPriority;
  /** When provided, the badge becomes a button that cycles to the next
   *  priority on click. Omit for a read-only display. */
  onCycle?: (next: TaskPriority) => void;
  className?: string;
}

export function PriorityBadge({ priority, onCycle, className }: Props) {
  const style = priorityStyle[priority];
  const content = (
    <>
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {priority}
    </>
  );

  if (!onCycle) {
    return (
      <Badge className={cn("gap-1.5 capitalize", style.badge, className)}>{content}</Badge>
    );
  }

  return (
    <Badge
      asChild
      className={cn(
        "cursor-pointer gap-1.5 capitalize transition-colors hover:brightness-125",
        style.badge,
        className,
      )}
    >
      <button
        type="button"
        title="Click to change priority"
        onClick={(e) => {
          // Rows/cards open the editor on click — don't let that fire too.
          e.stopPropagation();
          onCycle(nextPriority(priority));
        }}
      >
        {content}
      </button>
    </Badge>
  );
}
