import { PauseCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { blockedDays, blockedLabel } from "@/lib/task-blocked";
import { cn } from "@/lib/utils";

// Dark-only app. A fresh block is amber (informational); once it has been
// sitting for a week it turns red, because that is the one that needs chasing.
const freshStyle = "border-amber-500/30 bg-amber-500/15 text-amber-400";
const staleStyle = "border-red-500/30 bg-red-500/15 text-red-400";

interface Props {
  /** One-line reason, shown in the tooltip. */
  note: string;
  /** `YYYY-MM-DD`; drives the day count and the colour. */
  since: string;
  /** When provided, the badge becomes a button that clears the block on
   *  click. Omit for a read-only display. */
  onUnblock?: () => void;
  className?: string;
}

export function BlockedBadge({ note, since, onUnblock, className }: Props) {
  const days = blockedDays(since);
  const style = days !== null && days >= 7 ? staleStyle : freshStyle;
  const content = (
    <>
      <PauseCircle className="size-3" />
      {blockedLabel(since)}
    </>
  );
  // The note is the whole point of the tooltip, so lead with it and keep the
  // click hint as a suffix.
  const hint = onUnblock ? "Click to unblock" : "";
  const title = note ? (hint ? `${note} — ${hint}` : note) : hint || "Blocked";

  if (!onUnblock) {
    return (
      <Badge className={cn("gap-1", style, className)} title={title}>
        {content}
      </Badge>
    );
  }

  return (
    <Badge
      asChild
      className={cn("cursor-pointer gap-1 transition-colors hover:brightness-125", style, className)}
    >
      <button
        type="button"
        title={title}
        onClick={(e) => {
          // Rows/cards open the editor on click — don't let that fire too.
          e.stopPropagation();
          onUnblock();
        }}
      >
        {content}
      </button>
    </Badge>
  );
}
