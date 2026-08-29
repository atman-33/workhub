// The app's one tooltip helper: everything hoverable and explainable goes
// through here instead of the native `title` attribute, whose browser-styled
// popup clashes with the dark theme (see .claude/rules/ui-conventions.md).
//
// `children` must be a single element that accepts a ref (button, span, div,
// p, ...). Because the trigger renders the child directly (asChild), the DOM
// shape does not change and layout is unaffected.
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Hint({
  label,
  disabled,
  children,
}: {
  /** Tooltip text; `\n` breaks lines (`whitespace-pre-line`). When empty or
   *  undefined the child renders bare — handy for a hint that only exists in
   *  some states (`isToday`, an error message, ...). */
  label?: ReactNode;
  /** Disabled elements swallow hover events, so the tooltip would never
   *  open. When set, the child is rendered inside a span that becomes the
   *  hover target and the child itself gets `pointer-events-none` (radix's
   *  own recommendation for disabled triggers). */
  disabled?: boolean;
  children: ReactElement;
}) {
  if (label == null || label === "") return children;
  const child = disabled
    ? cloneElement(children as ReactElement<{ className?: string }>, {
        className: cn((children.props as { className?: string }).className, "pointer-events-none"),
      })
    : children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{child}</span> : child}
      </TooltipTrigger>
      <TooltipContent className="whitespace-pre-line">{label}</TooltipContent>
    </Tooltip>
  );
}
