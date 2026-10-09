import { useEffect, useRef } from "react";

/** Inline rename. Enter commits, Escape abandons, blur commits — the same
 * bargain the task board's inline fields make.
 *
 * The value lives in the canvas so the box can size itself to the text; this
 * component only owns focus.
 */
export function NodeInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      // Its own background and text colour rather than the node's: the root is
      // drawn in the foreground colour, so an inherited-colour field on it was
      // white text on white.
      className="size-full rounded border border-ring bg-background px-2 text-center text-sm text-foreground outline-none"
    />
  );
}
