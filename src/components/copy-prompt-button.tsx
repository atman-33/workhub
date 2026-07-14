import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type CopyState = "idle" | "copying" | "success";

const LABELS: Record<CopyState, string> = {
  idle: "Copy prompt",
  copying: "Copying…",
  success: "Copied",
};

interface Props {
  /** Copies the task prompt to the clipboard; the button animates feedback. */
  onCopy: () => Promise<unknown>;
  /** Render the state label next to the icon instead of an icon-only button. */
  showLabel?: boolean;
  size?: VariantProps<typeof buttonVariants>["size"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  className?: string;
  disabled?: boolean;
}

/**
 * Copies the AI agent prompt for a task to the clipboard. Used on the task
 * list, kanban card, and task editor so the user can paste the prompt into
 * another AI terminal manually.
 */
export function CopyPromptButton({
  onCopy,
  showLabel = false,
  size,
  variant = "outline",
  className,
  disabled,
}: Props) {
  const [state, setState] = useState<CopyState>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (state !== "idle") return;
    setState("copying");
    try {
      await onCopy();
    } catch {
      if (mounted.current) setState("idle");
      return;
    }
    if (!mounted.current) return;
    setState("success");
    await new Promise((r) => setTimeout(r, 1200));
    if (mounted.current) setState("idle");
  }, [onCopy, state]);

  const busy = state !== "idle";
  const resolvedSize = size ?? (showLabel ? "xs" : "icon-xs");

  const icon =
    state === "copying" ? (
      <Copy className="animate-pulse" />
    ) : state === "success" ? (
      <Check className="text-emerald-500" />
    ) : (
      <Copy />
    );

  const button = (
    <Button
      type="button"
      size={resolvedSize}
      variant={variant}
      disabled={disabled || busy}
      aria-label="Copy prompt"
      aria-busy={state === "copying"}
      className={cn(
        busy && "opacity-100 disabled:opacity-100",
        state === "success" && "border-emerald-500/50 bg-emerald-500/15 text-emerald-500",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        void handleClick();
      }}
    >
      {icon}
      {showLabel && <span>{LABELS[state]}</span>}
    </Button>
  );

  if (showLabel) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{LABELS[state]}</TooltipContent>
    </Tooltip>
  );
}
