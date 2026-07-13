import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Loader2 } from "lucide-react";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type LaunchState = "idle" | "launching" | "success";

// The Rust launch command returns as soon as the terminal process is *spawned*,
// well before the window is visible and the agent has booted. So we can't tie
// the click feedback to the promise alone — it resolves in a few hundred ms and
// the animation would flash by. Hold the "launching" state for at least this
// long to bridge the gap until the terminal actually appears on screen.
const MIN_LAUNCH_MS = 2500;
const SUCCESS_MS = 1200;

const LABELS: Record<LaunchState, string> = {
  idle: "Launch agent",
  launching: "Launching…",
  success: "Launched",
};

interface Props {
  /** Kicks off the launch; the button animates until it settles (or fails). */
  onLaunch: () => Promise<unknown>;
  /** Render the state label next to the icon instead of an icon-only button. */
  showLabel?: boolean;
  size?: VariantProps<typeof buttonVariants>["size"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  className?: string;
  disabled?: boolean;
}

/**
 * Shared launch trigger used on the task list, the kanban card, and the task
 * editor. Encapsulates the click-to-visible-feedback animation so every entry
 * point behaves identically.
 */
export function LaunchAgentButton({
  onLaunch,
  showLabel = false,
  size,
  variant = "outline",
  className,
  disabled,
}: Props) {
  const [state, setState] = useState<LaunchState>("idle");
  // Guard the post-await setState calls so a dialog/card unmounting mid-launch
  // (e.g. the editor closing) doesn't warn about updating an unmounted node.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (state !== "idle") return;
    setState("launching");
    const started = Date.now();
    try {
      await onLaunch();
    } catch {
      // The caller surfaces the failure (status bar); just stop animating.
      if (mounted.current) setState("idle");
      return;
    }
    const remaining = Math.max(0, MIN_LAUNCH_MS - (Date.now() - started));
    await new Promise((r) => setTimeout(r, remaining));
    if (!mounted.current) return;
    setState("success");
    await new Promise((r) => setTimeout(r, SUCCESS_MS));
    if (mounted.current) setState("idle");
  }, [onLaunch, state]);

  const busy = state !== "idle";
  const resolvedSize = size ?? (showLabel ? "xs" : "icon-xs");

  const icon =
    state === "launching" ? (
      <Loader2 className="animate-spin" />
    ) : state === "success" ? (
      <Check className="text-emerald-500" />
    ) : (
      // Idle: tint the bot with the brand accent so it reads as an actionable
      // "AI agent" control, not just another muted glyph on the card.
      <Bot className="text-primary" />
    );

  const button = (
    <Button
      type="button"
      size={resolvedSize}
      variant={variant}
      disabled={disabled || busy}
      aria-label="Launch agent"
      aria-busy={state === "launching"}
      className={cn(
        // Keep the disabled-while-busy button fully visible so the animation
        // reads as "working", not "greyed out".
        busy && "opacity-100 disabled:opacity-100",
        // Tinted background + border so the control reads as a colored, tappable
        // "AI agent" chip. cn() is tailwind-merge, so these win over the outline
        // variant's default background/border/hover.
        state === "idle" &&
          "border-primary/30 bg-primary/15 text-primary hover:border-primary/40 hover:bg-primary/25 hover:text-primary",
        state === "launching" && "border-primary/50 bg-primary/15 text-primary",
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

  // Icon-only buttons need the tooltip for discoverability; labelled ones
  // already say what they do, so skip the redundant tooltip.
  if (showLabel) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{LABELS[state]}</TooltipContent>
    </Tooltip>
  );
}
