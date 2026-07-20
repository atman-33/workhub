import { BrainCircuit, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Dismiss for this app run only. */
  onDismiss: () => void;
  /** Persist check_memory_setup=false so the notice never shows again. */
  onDisable: () => void;
}

/**
 * Startup notice shown when the long-term memory engine has no setup marker
 * on this machine. Setup itself is an agent skill (heavy npm install + model
 * download with interactive recovery), so the banner only instructs — it
 * never installs anything.
 */
export function MemorySetupBanner({ onDismiss, onDisable }: Props) {
  return (
    <div className="flex h-10 items-center gap-3 bg-muted px-4 text-[13px]">
      <BrainCircuit className="size-4 shrink-0 text-primary" />
      <span className="truncate">
        <span className="font-medium">Long-term memory is not set up on this machine.</span>{" "}
        Run the <code className="rounded bg-background px-1">/memory-setup</code> skill in a
        Claude Code session on the vault to enable it.
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-6 shrink-0 px-2 text-xs text-muted-foreground"
        onClick={onDisable}
      >
        Don&apos;t show again
      </Button>
      <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={onDismiss}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
