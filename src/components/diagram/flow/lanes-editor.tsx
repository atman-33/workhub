import { ArrowDown, ArrowUp, Plus, Trash2, WandSparkles } from "lucide-react";
import { ColorSwatches, PanelFrame, TitleField } from "@/components/diagram/panel-frame";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { FlowLane } from "@/lib/diagram/flow/parse";
import { useT } from "@/lib/i18n";

/**
 * What the side panel shows with nothing selected: the lanes of the flow (add,
 * rename, colour, reorder, delete) and the "auto-align" command that forgets
 * every position a step was dragged to.
 */
export function LanesEditor({
  lanes,
  stepCount,
  canAutoAlign,
  onAdd,
  onChange,
  onMove,
  onDelete,
  onAutoAlign,
}: {
  lanes: FlowLane[];
  /** Steps per lane id, to say what deleting a lane leaves behind. */
  stepCount: (laneId: string) => number;
  canAutoAlign: boolean;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<FlowLane>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
  onAutoAlign: () => void;
}) {
  const t = useT();
  return (
    <PanelFrame>
      <div className="flex items-center justify-between">
        <span className="font-medium">{t("diagram.flow.lanesTitle")}</span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onAdd}>
          <Plus className="mr-1 size-3" />
          {t("common.add")}
        </Button>
      </div>
      {lanes.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{t("diagram.flow.noLanes")}</p>
      )}
      {lanes.map((lane, i) => (
        <div key={lane.id} className="space-y-1.5 rounded border p-2">
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <TitleField
                value={lane.title}
                placeholder={t("diagram.flow.laneNamePlaceholder")}
                onChange={(title) => onChange(lane.id, { title })}
              />
            </div>
            <Hint label={t("diagram.flow.moveLaneUpHint")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={i === 0}
                onClick={() => onMove(lane.id, -1)}
              >
                <ArrowUp className="size-3" />
              </Button>
            </Hint>
            <Hint label={t("diagram.flow.moveLaneDownHint")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={i === lanes.length - 1}
                onClick={() => onMove(lane.id, 1)}
              >
                <ArrowDown className="size-3" />
              </Button>
            </Hint>
            <Hint label={t("diagram.flow.deleteLaneHint", { count: stepCount(lane.id) })}>
              <Button size="icon" variant="ghost" className="size-6" onClick={() => onDelete(lane.id)}>
                <Trash2 className="size-3" />
              </Button>
            </Hint>
          </div>
          <ColorSwatches value={lane.color} onChange={(color) => onChange(lane.id, { color })} />
        </div>
      ))}

      <div className="space-y-1.5 border-t pt-3">
        <Hint label={t("diagram.flow.autoAlignHint")} disabled={!canAutoAlign}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!canAutoAlign}
            onClick={onAutoAlign}
          >
            <WandSparkles className="mr-1 size-3" />
            {t("diagram.flow.autoAlign")}
          </Button>
        </Hint>
      </div>
    </PanelFrame>
  );
}
