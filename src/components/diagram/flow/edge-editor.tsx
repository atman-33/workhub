import { ArrowRight } from "lucide-react";
import { DeleteButton, PanelFrame, TitleField } from "@/components/diagram/panel-frame";
import type { FlowEdge, FlowStep } from "@/lib/diagram/flow/parse";
import { useT } from "@/lib/i18n";

/**
 * Edit panel for the selected arrow: its label and the two steps it joins. The
 * ends are changed on the canvas, by dragging the end handles.
 */
export function EdgeEditor({
  edge,
  from,
  to,
  onChange,
  onDelete,
}: {
  edge: FlowEdge;
  from: FlowStep | null;
  to: FlowStep | null;
  onChange: (patch: Partial<FlowEdge>) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const name = (step: FlowStep | null, id: string) => (step?.title ? `${id} ${step.title}` : id);
  return (
    <PanelFrame>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{name(from, edge.from)}</span>
        <ArrowRight className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{name(to, edge.to)}</span>
      </div>
      <TitleField
        value={edge.label ?? ""}
        placeholder={t("diagram.flow.edgeLabelPlaceholder")}
        onChange={(label) => onChange({ label: label || undefined })}
      />
      <p className="text-[11px] text-muted-foreground">{t("diagram.flow.edgeHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.flow.deleteEdgeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
