import { StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Textarea } from "@/components/ui/textarea";
import { COLOR_HEX, COLORS, type Color } from "@/lib/diagram/colors";
import { STICKY_DEFAULT_COLOR, type Sticky } from "@/lib/diagram/sticky";
import { MINDMAP_COLOR_LABEL_KEY } from "@/lib/i18n/labels";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The sticky notes pinned to the selected element, in the side panel: add,
 * edit the text, pick the paper colour, remove. Shared by every diagram kind.
 */
export function StickyList({
  stickies,
  stickiesHidden,
  disabled,
  onAdd,
  onChange,
  onDelete,
}: {
  /** The stickies pinned to the selected element. */
  stickies: Sticky[];
  /** True while the note hides every sticky - an added one would land
   * somewhere invisible, so the panel says so. */
  stickiesHidden: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<Sticky>) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {t("mindmap.nodeEditor.stickyNotes")}
          {stickiesHidden && stickies.length > 0 && t("mindmap.nodeEditor.hiddenOnMap")}
        </span>
        <Hint label={t("mindmap.nodeEditor.pinStickyHint")} disabled={disabled}>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={disabled}
            onClick={onAdd}
          >
            <StickyNote className="mr-1 size-3" />
            {t("common.add")}
          </Button>
        </Hint>
      </div>

      {stickies.map((sticky) => (
        <div key={sticky.id} className="space-y-1.5 rounded border p-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground">{sticky.id}</span>
            <Hint label={t("mindmap.nodeEditor.removeStickyHint")} disabled={disabled}>
              <Button
                size="sm"
                variant="ghost"
                className="size-5 p-0"
                disabled={disabled}
                onClick={() => onDelete(sticky.id)}
              >
                <X className="size-3" />
              </Button>
            </Hint>
          </div>
          <Textarea
            value={sticky.text}
            placeholder={t("mindmap.nodeEditor.stickyTextPlaceholder")}
            rows={2}
            disabled={disabled}
            className="resize-none text-xs"
            onChange={(e) => onChange(sticky.id, { text: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="flex flex-wrap gap-1">
            {COLORS.map((color) => (
              <Hint key={color} label={t(MINDMAP_COLOR_LABEL_KEY[color])} disabled={disabled}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(sticky.id, { color: color as Color })}
                  style={{ background: COLOR_HEX[color as Color] }}
                  className={cn(
                    "size-4 rounded",
                    (sticky.color ?? STICKY_DEFAULT_COLOR) === color &&
                      "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                  )}
                />
              </Hint>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
