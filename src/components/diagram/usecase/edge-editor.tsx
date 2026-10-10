import { ArrowLeftRight, ArrowRight, Minus } from "lucide-react";
import { DeleteButton, PanelFrame, TitleField } from "@/components/diagram/panel-frame";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { UsecaseEdge, UsecaseNode } from "@/lib/diagram/usecase/parse";
import { useT } from "@/lib/i18n";

/**
 * Edit panel for the selected line: its label, whether it carries an arrow
 * (off by default: a use case line is a relation, not a flow), the direction
 * when it does, and the two nodes it joins. The ends are changed on the
 * canvas, by dragging the end handles.
 */
export function EdgeEditor({
  edge,
  from,
  to,
  onChangeLabel,
  onChangeArrow,
  onReverse,
  onDelete,
}: {
  edge: UsecaseEdge;
  from: UsecaseNode | null;
  to: UsecaseNode | null;
  onChangeLabel: (label: string | undefined) => void;
  onChangeArrow: (arrow: boolean) => void;
  onReverse: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const name = (node: UsecaseNode | null, id: string) => (node?.title ? `${id} ${node.title}` : id);
  return (
    <PanelFrame>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{name(from, edge.from)}</span>
        {edge.arrow ? (
          <ArrowRight className="size-3 shrink-0" />
        ) : (
          <Minus className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{name(to, edge.to)}</span>
      </div>
      <TitleField
        value={edge.label ?? ""}
        placeholder={t("diagram.usecase.edgeLabelPlaceholder")}
        onChange={(label) => onChangeLabel(label || undefined)}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">
          {t("diagram.usecase.edgeArrowLabel")}
        </span>
        <div className="flex items-center rounded-md border p-0.5">
          <Button
            size="sm"
            variant={edge.arrow ? "ghost" : "secondary"}
            className="h-6 px-2 text-[11px]"
            onClick={() => onChangeArrow(false)}
          >
            {t("diagram.usecase.edgeArrowOff")}
          </Button>
          <Button
            size="sm"
            variant={edge.arrow ? "secondary" : "ghost"}
            className="h-6 px-2 text-[11px]"
            onClick={() => onChangeArrow(true)}
          >
            {t("diagram.usecase.edgeArrowOn")}
          </Button>
        </div>
        <Hint label={t("diagram.usecase.edgeReverseHint")}>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={!edge.arrow}
            onClick={onReverse}
          >
            <ArrowLeftRight className="mr-1 size-3" />
            {t("diagram.usecase.edgeReverse")}
          </Button>
        </Hint>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("diagram.usecase.edgeHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.usecase.deleteEdgeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
