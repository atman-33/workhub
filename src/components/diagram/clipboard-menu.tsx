import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useT } from "@/lib/i18n";

/**
 * The right-click side of copy and paste (T-0688), shared by every diagram kind.
 *
 * The shortcuts do the same things, but a menu is how someone who does not
 * know them finds the feature, so the entries show the shortcut beside them.
 */

export interface ClipboardActions {
  /** Absent where the menu is about empty canvas rather than a node. */
  onCopy?: () => void;
  onDuplicate?: () => void;
  onPaste?: () => void;
  /** False when nothing has been copied from this note: Paste greys out. */
  canPaste: boolean;
  /** True while an AI edit holds the file. */
  readOnly?: boolean;
}

/** What a canvas is handed to offer copy and paste: acts on a node by id. */
export interface CanvasClipboard {
  canPaste: boolean;
  onCopy: (id: string) => void;
  onDuplicate: (id: string) => void;
  onPaste: () => void;
}

/** Copy / Duplicate / Paste rows, for a menu that already exists or the ones below. */
export function ClipboardMenuItems({
  onCopy,
  onDuplicate,
  onPaste,
  canPaste,
  readOnly,
}: ClipboardActions) {
  const t = useT();
  return (
    <>
      {onCopy && (
        <ContextMenuItem onSelect={onCopy}>
          <span className="flex-1 truncate">{t("diagram.clipboard.copy")}</span>
          <span className="text-[10px] text-muted-foreground">Ctrl+C</span>
        </ContextMenuItem>
      )}
      {onDuplicate && (
        <ContextMenuItem disabled={readOnly} onSelect={onDuplicate}>
          <span className="flex-1 truncate">{t("diagram.clipboard.duplicate")}</span>
        </ContextMenuItem>
      )}
      {onPaste && (
        <ContextMenuItem disabled={readOnly || !canPaste} onSelect={onPaste}>
          <span className="flex-1 truncate">{t("diagram.clipboard.paste")}</span>
          <span className="text-[10px] text-muted-foreground">Ctrl+V</span>
        </ContextMenuItem>
      )}
    </>
  );
}

/** Stops a right-click on a node from also opening the menu of the canvas under it. */
const stopContextMenu = (e: React.MouseEvent) => e.stopPropagation();

/**
 * Puts the clipboard menu on one node. On a canvas (`svg`) `children` is the
 * node's own `<g>`, which becomes the trigger as it is. Elsewhere it is any
 * markup, wrapped in a `display: contents` `<div>` that adds no box of its
 * own, so absolutely positioned bars keep their containing block.
 */
export function NodeClipboardMenu({
  svg,
  children,
  ...actions
}: ClipboardActions & { svg?: boolean; children: ReactNode }) {
  const content = (
    <ContextMenuContent className="min-w-40">
      <ClipboardMenuItems {...actions} />
    </ContextMenuContent>
  );
  if (svg) {
    return (
      <g onContextMenu={stopContextMenu}>
        <ContextMenu>
          <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
          {content}
        </ContextMenu>
      </g>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="contents" onContextMenu={stopContextMenu}>
          {children}
        </div>
      </ContextMenuTrigger>
      {content}
    </ContextMenu>
  );
}
