import { ArrowRight } from "lucide-react";
import { DeleteButton, PanelFrame, TitleField } from "@/components/diagram/panel-frame";
import type { IfdamEdge, IfdamNode } from "@/lib/diagram/ifdam/parse";
import { useT } from "@/lib/i18n";

/**
 * Edit panel for the selected arrow: its label and the two nodes it joins.
 * The label is typed - no candidate buttons, because IFDAM has no standard
 * set of labels (a writer picks "success", "failure" or a message name). The
 * ends are changed on the canvas, by dragging the end handles.
 */
export function EdgeEditor({
  edge,
  from,
  to,
  onChange,
  onDelete,
}: {
  edge: IfdamEdge;
  from: IfdamNode | null;
  to: IfdamNode | null;
  onChange: (label: string | undefined) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const name = (node: IfdamNode | null, id: string) => (node?.title ? `${id} ${node.title}` : id);
  return (
    <PanelFrame>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{name(from, edge.from)}</span>
        <ArrowRight className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{name(to, edge.to)}</span>
      </div>
      <TitleField
        value={edge.label ?? ""}
        placeholder={t("diagram.ifdam.edgeLabelPlaceholder")}
        onChange={(label) => onChange(label || undefined)}
      />
      <p className="text-[11px] text-muted-foreground">{t("diagram.ifdam.edgeHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.ifdam.deleteEdgeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
