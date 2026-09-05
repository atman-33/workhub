import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type CopyState = "idle" | "copying" | "success";

const BUSY_LABELS: Record<Exclude<CopyState, "idle">, string> = {
  copying: "Copying…",
  success: "Copied",
};

const DEFAULT_LABEL = "Copy prompt";

interface Props {
  /** Copies the task prompt to the clipboard; the button animates feedback. */
  onCopy: () => Promise<unknown>;
  /**
   * What this button copies, in the resting state — shown as the label and in
   * the tooltip. Worth setting wherever two of these sit on one screen: the
   * default says a prompt is copied but not which one, which is exactly the
   * question the Projects tab left unanswered (T-0248).
   */
  label?: string;
  /** Render the state label next to the icon instead of an icon-only button. */
  showLabel?: boolean;
  size?: VariantProps<typeof buttonVariants>["size"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  className?: string;
  disabled?: boolean;
}

/**
 * Copies an AI agent prompt to the clipboard, for pasting into an AI terminal
 * by hand. Used on the task list, kanban card and task editor for a task's own
 * prompt, and on the Projects tab for the two project-level prompts — which is
 * why `label` exists: those two sit on one screen and the shared "Copy prompt"
 * named neither of them.
 */
export function CopyPromptButton({
  onCopy,
  label = DEFAULT_LABEL,
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
  // The resting label is the caller's; the two busy states are the button's own
  // feedback and read the same whatever it copies.
  const currentLabel = state === "idle" ? label : BUSY_LABELS[state];

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
      aria-label={label}
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
      {showLabel && <span>{currentLabel}</span>}
    </Button>
  );

  if (showLabel) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{currentLabel}</TooltipContent>
    </Tooltip>
  );
}
