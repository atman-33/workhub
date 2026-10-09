import { ArrowRight } from "lucide-react";
import { DeleteButton, PanelFrame } from "@/components/diagram/panel-frame";
import type { PfdEdge, PfdNode } from "@/lib/diagram/pfd/parse";
import { useT } from "@/lib/i18n";

/**
 * Edit panel for the selected arrow: the two nodes it joins. The ends are
 * changed on the canvas, by dragging the end handles; an arrow has no other
 * attribute.
 */
export function EdgeEditor({
  edge,
  from,
  to,
  onDelete,
}: {
  edge: PfdEdge;
  from: PfdNode | null;
  to: PfdNode | null;
  onDelete: () => void;
}) {
  const t = useT();
  const name = (node: PfdNode | null, id: string) => (node?.title ? `${id} ${node.title}` : id);
  return (
    <PanelFrame>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{name(from, edge.from)}</span>
        <ArrowRight className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{name(to, edge.to)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("diagram.pfd.edgeHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.pfd.deleteEdgeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
