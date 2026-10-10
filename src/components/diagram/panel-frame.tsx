import { useEffect, useState, type ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { usePanelRef } from "react-resizable-panels";
import {
  Check,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COLOR_HEX, COLORS, type Color } from "@/lib/diagram/colors";
import { useT } from "@/lib/i18n";
import { MINDMAP_COLOR_LABEL_KEY } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

/**
 * The pieces every element side panel is built from: the id header, the title
 * and note fields, the colour swatches, the task link and the delete button.
 *
 * They were the common part of the Mindmap node editor and the 2x2 item editor;
 * the business flow's step and arrow panels (and the PFD's later) use them
 * too, so a kind's panel only adds what is its own.
 *
 * Like those editors, none of these holds draft state: every field renders
 * straight from the element, so a rename or a drag on the canvas shows up here
 * immediately.
 */

/** The panel's outer box. Width comes from the sidebar column, not from here. */
export function PanelFrame({ children }: { children: ReactNode }) {
  return <div className="shrink-0 space-y-3 border-b p-3 text-xs">{children}</div>;
}

/** The icon button that hides or shows a side panel (T-0691). It sits in the
 * Diagrams tab's strip, the left panel's at the far left and the right panel's
 * at the far right, so nothing reaches into the canvas. The glyph is the
 * "toggle sidebar" rectangle with a divider near `side`'s edge: the closed
 * variant carries a chevron toward where the panel will open. */
export function PanelToggle({
  side,
  open,
  disabled,
  onToggle,
}: {
  side: "left" | "right";
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const Icon =
    side === "left" ? (open ? PanelLeftClose : PanelLeftOpen) : open ? PanelRightClose : PanelRightOpen;
  const label =
    side === "left"
      ? open
        ? t("diagram.panel.hideLeft")
        : t("diagram.panel.showLeft")
      : open
        ? t("diagram.panel.hideRight")
        : t("diagram.panel.showRight");
  return (
    <Hint label={label} disabled={disabled}>
      <Button
        type="button"
        size="icon"
        variant={open ? "secondary" : "ghost"}
        className="size-7"
        aria-label={label}
        aria-pressed={open}
        disabled={disabled}
        onClick={onToggle}
      >
        <Icon className="size-4" />
      </Button>
    </Hint>
  );
}

/**
 * The right-hand column of an editor view: a divider and a panel that can be
 * hidden (T-0686); the button that brings it back is in the Diagrams strip. `open` comes from the vault settings; dragging the divider
 * to nothing reports back through `onOpenChange`, so the two never disagree.
 *
 * The panel stays mounted while hidden and is collapsed through the panel
 * group's own API: `react-resizable-panels` recomputes its layout when the
 * number of panels changes, and taking one away mid-session collapsed the
 * canvas beside it (the trap the Mindmap tab hit in T-0188). Collapsing also
 * remembers the width it was dragged to.
 */
export function SidePanel({
  id,
  open,
  onOpenChange,
  defaultSize,
  minSize = "16%",
  maxSize,
  children,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSize: string;
  minSize?: string;
  maxSize?: string;
  children: ReactNode;
}) {
  const panel = usePanelRef();
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    if (open && p.isCollapsed()) p.expand();
    else if (!open && !p.isCollapsed()) p.collapse();
  }, [open, panel]);
  return (
    <>
      <ResizableHandle />
      <ResizablePanel
        id={id}
        panelRef={panel}
        defaultSize={open ? defaultSize : "0%"}
        minSize={minSize}
        maxSize={maxSize}
        collapsible
        collapsedSize={0}
        onResize={(size) => {
          const collapsed = size.asPercentage === 0;
          if (collapsed === open) onOpenChange(!collapsed);
        }}
        className="min-h-0 min-w-0"
      >
        {children}
      </ResizablePanel>
    </>
  );
}

/** Folds pasted line breaks into spaces. A title is one grammar line in the
 * file, so a newline there would emit a second, unparsable line; multi-line
 * text belongs in the note. */
export function collapseLines(value: string): string {
  return value.split(/\s*[\r\n]+\s*/).join(" ");
}

/** The element id, one click from the clipboard (it is how an AI is told which
 * element is meant), with an optional note on the right. */
export function IdHeader({
  id,
  copyHint,
  aside,
}: {
  id: string;
  copyHint: string;
  aside?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; the id is on screen
    }
  };
  return (
    <div className="flex items-center justify-between">
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{id}</span>
        <Hint label={copyHint}>
          <Button size="icon" variant="ghost" className="size-5" onClick={copy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
        </Hint>
      </span>
      {aside}
    </div>
  );
}

/** A one-line title field. The canvas owns Delete, Enter and the arrows as
 * element commands; inside a text field they have to mean what they always mean. */
export function TitleField({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      className="h-8 text-xs"
      onChange={(e) => onChange(collapseLines(e.target.value))}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export function NoteField({
  value,
  placeholder,
  disabled,
  rows = 3,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <Textarea
      value={value}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className="resize-none text-xs"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

/** The palette as swatches. Clicking the current colour clears it, so an
 * element can go back to having none - otherwise the only way out of a colour
 * would be editing the file by hand. */
export function ColorSwatches({
  value,
  disabled,
  onChange,
}: {
  value: Color | undefined;
  disabled?: boolean;
  onChange: (color: Color | undefined) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map((color) => (
        <Hint key={color} label={t(MINDMAP_COLOR_LABEL_KEY[color])} disabled={disabled}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(value === color ? undefined : color)}
            style={{ background: COLOR_HEX[color] }}
            className={cn(
              "size-5 rounded",
              value === color && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
            )}
          />
        </Hint>
      ))}
    </div>
  );
}

/** Sentinel for a Select's "no value" option - Radix rejects an empty string. */
export const NONE = "__none__";

/** The `task:` link. A linked task that is not in the list (another project's,
 * or archived) still shows as the current value. */
export function TaskSelect({
  value,
  tasks,
  disabled,
  onChange,
}: {
  value: string | undefined;
  tasks: Task[];
  disabled?: boolean;
  onChange: (task: string | undefined) => void;
}) {
  const t = useT();
  const known = !value || tasks.some((task) => task.id === value);
  return (
    <Select
      value={value ?? NONE}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NONE ? undefined : v)}
    >
      <SelectTrigger className="h-7 text-xs">
        <SelectValue placeholder={t("schedule.itemEditor.noLinkedTask")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("schedule.itemEditor.noLinkedTask")}</SelectItem>
        {!known && value && <SelectItem value={value}>{value}</SelectItem>}
        {tasks.map((task) => (
          <SelectItem key={task.id} value={task.id}>
            {task.id} {task.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DeleteButton({
  hint,
  disabled,
  onClick,
}: {
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Hint label={hint} disabled={disabled}>
      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={disabled} onClick={onClick}>
        <Trash2 className="mr-1 size-3" />
        {t("common.delete")}
      </Button>
    </Hint>
  );
}
