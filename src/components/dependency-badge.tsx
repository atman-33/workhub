import { Link2 } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

interface Props {
  /** Predecessors that are not done yet — never empty. */
  waiting: readonly Task[];
  className?: string;
}

/**
 * "Waiting on T-0012" on a card or row: the task has predecessors that are
 * still open.
 *
 * It is deliberately not the blocked badge. Blocked is a flag a person sets
 * for an external wait and stays until they clear it; this one is derived from
 * the predecessors' status and disappears on its own when they reach `done`.
 * Different glyph (a link, not 🛑) and greyscale, since colour on a card
 * belongs to priority.
 */
export function DependencyBadge({ waiting, className }: Props) {
  const t = useT();
  const ids = waiting.map((w) => w.id).join(", ");
  const tooltip = [
    t("task.dependency.waitingTooltip"),
    ...waiting.map((w) => `${w.id} ${w.title} [${w.status}]`),
  ].join("\n");

  return (
    <Hint label={tooltip}>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1 rounded-md border border-dashed border-border bg-muted/40 px-1.5 py-0.5 text-[10px] leading-tight text-muted-foreground",
          className,
        )}
      >
        <Link2 className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{t("task.dependency.waiting", { ids })}</span>
      </span>
    </Hint>
  );
}
