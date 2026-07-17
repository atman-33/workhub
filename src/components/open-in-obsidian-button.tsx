import { useCallback, useEffect, useRef, useState } from "react";
import { Gem } from "lucide-react";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

interface Props {
  /** Opens the task file in Obsidian; errors are surfaced by the caller. */
  onOpen: () => Promise<unknown>;
  size?: VariantProps<typeof buttonVariants>["size"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  className?: string;
  disabled?: boolean;
}

/**
 * Jumps to the task's Markdown file in Obsidian (gem icon, matching the
 * Obsidian logo). Used on the task list, kanban card, and the task editor.
 */
export function OpenInObsidianButton({
  onOpen,
  size = "icon-xs",
  variant = "outline",
  className,
  disabled,
}: Props) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onOpen();
    } catch {
      // The caller surfaces the error (status bar); just settle the button.
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, onOpen]);

  const button = (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={disabled || busy}
      aria-label="Edit in Obsidian"
      aria-busy={busy}
      className={cn(busy && "opacity-100 disabled:opacity-100", className)}
      onClick={(e) => {
        e.stopPropagation();
        void handleClick();
      }}
    >
      <Gem className={cn(busy && "animate-pulse")} />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>Edit in Obsidian</TooltipContent>
    </Tooltip>
  );
}
