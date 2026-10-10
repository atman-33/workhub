import { ArrowRight } from "lucide-react";
import { DeleteButton, PanelFrame, TitleField } from "@/components/diagram/panel-frame";
import { Button } from "@/components/ui/button";
import { EDGE_LABEL_CANDIDATES } from "@/lib/diagram/algorithm/labels";
import type { AlgorithmEdge, AlgorithmNode } from "@/lib/diagram/algorithm/parse";
import { useLocale, useT } from "@/lib/i18n";

/**
 * Edit panel for the selected arrow: its label and the two nodes it joins.
 * The label is typed, or set with a candidate button (yes / no, in the
 * interface language): it is never filled in when the arrow is drawn, because
 * the file holds a language-free string and the writer chooses it. The ends
 * are changed on the canvas, by dragging the end handles.
 */
export function EdgeEditor({
  edge,
  from,
  to,
  onChange,
  onDelete,
}: {
  edge: AlgorithmEdge;
  from: AlgorithmNode | null;
  to: AlgorithmNode | null;
  onChange: (label: string | undefined) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const name = (node: AlgorithmNode | null, id: string) =>
    node?.title ? `${id} ${node.title}` : id;
  return (
    <PanelFrame>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{name(from, edge.from)}</span>
        <ArrowRight className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{name(to, edge.to)}</span>
      </div>
      <TitleField
        value={edge.label ?? ""}
        placeholder={t("diagram.algorithm.edgeLabelPlaceholder")}
        onChange={(label) => onChange(label || undefined)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {EDGE_LABEL_CANDIDATES[locale].map((label) => (
          <Button
            key={label}
            size="sm"
            variant={edge.label === label ? "secondary" : "outline"}
            className="h-7 text-xs"
            onClick={() => onChange(label)}
          >
            {label}
          </Button>
        ))}
        {edge.label && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onChange(undefined)}
          >
            {t("diagram.algorithm.clearLabel")}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("diagram.algorithm.edgeHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.algorithm.deleteEdgeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
