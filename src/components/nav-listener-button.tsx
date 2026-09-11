import { AlertTriangle, Check, Keyboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { useRestartInputListener } from "@/lib/use-restart-input-listener";

/** The Input listener panel's restart, one click away in the nav bar (T-0280):
 * when a gesture stops responding the owner wants it back now, not three
 * clicks deep in Settings. It is shown whether or not a gesture is enabled —
 * the Ink and Clips tabs save straight to disk, so the settings held by the
 * shell can be stale, and a button that hides on a stale flag is worse than
 * one that is always there. Diagnostics stay in Settings → General. */
export function NavListenerButton() {
  const { restart, restarting, restarted, error } = useRestartInputListener();

  const label = error
    ? `Restart failed: ${error}`
    : restarted
      ? "Input listener restarted"
      : "Restart input listener\nUse when the double-press Alt annotation or the clips popup stops responding";

  return (
    <Hint label={label} disabled={restarting}>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Restart input listener"
        onClick={() => void restart()}
        disabled={restarting}
      >
        {restarting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : restarted ? (
          <Check className="size-4 text-green-500" />
        ) : error ? (
          <AlertTriangle className="size-4 text-destructive" />
        ) : (
          <Keyboard className="size-4" />
        )}
      </Button>
    </Hint>
  );
}
