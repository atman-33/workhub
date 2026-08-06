import { PauseCircle } from "lucide-react";
import { blockedAge } from "@/lib/task-blocked";
import { cn } from "@/lib/utils";

interface Props {
  /** One-line reason. Shown inline (truncated) and in full in the tooltip. */
  note: string;
  /** `YYYY-MM-DD`; drives the age suffix. */
  since: string;
  /** When provided, the whole badge becomes a button that opens the reason
   *  editor — the shortest route to recording or changing why a task waits. */
  onEdit?: () => void;
  className?: string;
}

/**
 * The blocked marker on a card or row: pause icon, age, reason.
 *
 * Deliberately greyscale. Colour is priority's language — which task to do
 * first — and a blocked task is one that cannot be done at all, so competing
 * for the same amber/red vocabulary made the two badges read as variants of
 * each other. A block that has gone stale is surfaced by the toolbar's counter
 * instead, where it is one signal for the whole board rather than noise on
 * every card.
 */
export function BlockedBadge({ note, since, onEdit, className }: Props) {
  const age = blockedAge(since);
  const hint = onEdit ? "Click to edit the reason" : "";
  const title = [note || "Blocked", hint].filter(Boolean).join(" — ");

  const content = (
    <>
      <PauseCircle className="size-3 shrink-0" />
      {age && <span className="shrink-0 tabular-nums">{age}</span>}
      {note && (
        <>
          <span aria-hidden className="shrink-0 opacity-50">
            ·
          </span>
          <span className="truncate">{note}</span>
        </>
      )}
    </>
  );

  const shape =
    "flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] leading-tight text-muted-foreground";

  if (!onEdit) {
    return (
      <span className={cn(shape, className)} title={title}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={cn(shape, "text-left transition-colors hover:bg-accent/60", className)}
      title={title}
      onClick={(e) => {
        // Rows/cards open the editor on click — don't let that fire too.
        e.stopPropagation();
        onEdit();
      }}
    >
      {content}
    </button>
  );
}
