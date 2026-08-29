import { Hint } from "@/components/ui/hint";
import { blockedAge } from "@/lib/task-blocked";
import { cn } from "@/lib/utils";

/**
 * The 🛑 that prefixes a blocked task's title — the one thing on a card that
 * says "blocked" before anything is read. It is deliberately not in priority's
 * language: colour on a card means how urgent the task is, and this is a
 * different question, so it gets a glyph of its own instead of a hue.
 */
export function BlockedMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Blocked"
      // Emoji come from a fallback font with taller metrics than the UI face,
      // which would leave blocked titles standing a row apart from the rest.
      // Pinning the size and collapsing the line box holds the line height.
      className={cn("mr-1 inline-block align-baseline text-[0.9em] leading-none", className)}
    >
      🛑
    </span>
  );
}

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
 * How long a task has been waiting and what for, on a card or row.
 *
 * The 🛑 on the title already announces the block, so this carries no icon of
 * its own — it answers the follow-up questions, and doubles as the button that
 * edits the answer. Greyscale throughout: colour on a card belongs to priority.
 * A block that has gone stale is surfaced by the toolbar's counter instead,
 * where it is one signal for the whole board rather than noise on every card.
 */
export function BlockedBadge({ note, since, onEdit, className }: Props) {
  const age = blockedAge(since);
  const hint = onEdit ? "Click to edit the reason" : "";
  const title = [note || "Blocked", hint].filter(Boolean).join(" — ");

  const content = (
    <>
      {age && <span className="shrink-0 tabular-nums">{age}</span>}
      {age && note && (
        <span aria-hidden className="shrink-0 opacity-50">
          ·
        </span>
      )}
      {note ? (
        <span className="truncate">{note}</span>
      ) : (
        // Neither a date nor a reason: without a fallback the badge would be an
        // empty box that still has to be clickable to fix that.
        !age && <span className="truncate">Blocked</span>
      )}
    </>
  );

  const shape =
    "flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] leading-tight text-muted-foreground";

  if (!onEdit) {
    return (
      <Hint label={title}>
        <span className={cn(shape, className)}>{content}</span>
      </Hint>
    );
  }

  return (
    <Hint label={title}>
      <button
        type="button"
        className={cn(shape, "text-left transition-colors hover:bg-accent/60", className)}
        onClick={(e) => {
          // Rows/cards open the editor on click — don't let that fire too.
          e.stopPropagation();
          onEdit();
        }}
      >
        {content}
      </button>
    </Hint>
  );
}
