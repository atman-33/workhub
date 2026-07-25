import { useCallback, useEffect, useRef, useState } from "react";
import { Check, MonitorUp } from "lucide-react";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type SendState = "idle" | "sending" | "success";

const LABELS: Record<SendState, string> = {
  idle: "Send to Claude Desktop",
  sending: "Sending…",
  success: "Sent",
};

interface Props {
  /** Opens Claude Desktop with the task prompt; the button animates feedback. */
  onSend: () => Promise<unknown>;
  /** Render the state label next to the icon instead of an icon-only button. */
  showLabel?: boolean;
  /** Appended to the idle tooltip, e.g. "code session" / "chat", so the user
   * can tell which kind of session the current setting will open. */
  mode?: string;
  size?: VariantProps<typeof buttonVariants>["size"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  className?: string;
  disabled?: boolean;
}

/**
 * Sends a task's AI agent prompt to a new Claude Desktop session via the
 * `claude://` URL scheme — the one-click form of "Copy prompt" followed by a
 * manual paste. Used on the task list, kanban card, and task editor.
 */
export function ClaudeDesktopButton({
  onSend,
  showLabel = false,
  mode,
  size,
  variant = "outline",
  className,
  disabled,
}: Props) {
  const [state, setState] = useState<SendState>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (state !== "idle") return;
    setState("sending");
    try {
      await onSend();
    } catch {
      if (mounted.current) setState("idle");
      return;
    }
    if (!mounted.current) return;
    setState("success");
    await new Promise((r) => setTimeout(r, 1200));
    if (mounted.current) setState("idle");
  }, [onSend, state]);

  const busy = state !== "idle";
  const resolvedSize = size ?? (showLabel ? "xs" : "icon-xs");

  const icon =
    state === "sending" ? (
      <MonitorUp className="animate-pulse" />
    ) : state === "success" ? (
      <Check className="text-emerald-500" />
    ) : (
      <MonitorUp />
    );

  const button = (
    <Button
      type="button"
      size={resolvedSize}
      variant={variant}
      disabled={disabled || busy}
      aria-label="Send to Claude Desktop"
      aria-busy={state === "sending"}
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
  const tooltip = state === "idle" && mode ? `${LABELS.idle} (${mode})` : LABELS[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
