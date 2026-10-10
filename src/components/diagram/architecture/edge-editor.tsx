import { ArrowLeftRight, MoveRight } from "lucide-react";
import { DeleteButton, PanelFrame, TitleField } from "@/components/diagram/panel-frame";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { ArchitectureEdge, ArchitectureNode } from "@/lib/diagram/architecture/parse";
import { useT } from "@/lib/i18n";

/**
 * Edit panel for the selected arrow: its label, one way or both, and the two
 * blocks it joins. The ends are changed on the canvas, by dragging the end
 * handles. Reversing a two-way arrow reads the same either way round, so the
 * button is offered for one-way arrows only.
 */
export function EdgeEditor({
  edge,
  from,
  to,
  onChangeLabel,
  onChangeBidi,
  onReverse,
  onDelete,
}: {
  edge: ArchitectureEdge;
  from: ArchitectureNode | null;
  to: ArchitectureNode | null;
  onChangeLabel: (label: string | undefined) => void;
  onChangeBidi: (bidi: boolean) => void;
  onReverse: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const name = (node: ArchitectureNode | null, id: string) =>
    node?.title ? `${id} ${node.title}` : id;
  return (
    <PanelFrame>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{name(from, edge.from)}</span>
        {edge.bidi ? (
          <ArrowLeftRight className="size-3 shrink-0" />
        ) : (
          <MoveRight className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{name(to, edge.to)}</span>
      </div>
      <TitleField
        value={edge.label ?? ""}
        placeholder={t("diagram.architecture.edgeLabelPlaceholder")}
        onChange={(label) => onChangeLabel(label || undefined)}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">
          {t("diagram.architecture.edgeBidiLabel")}
        </span>
        <div className="flex items-center rounded-md border p-0.5">
          <Button
            size="sm"
            variant={edge.bidi ? "ghost" : "secondary"}
            className="h-6 px-2 text-[11px]"
            onClick={() => onChangeBidi(false)}
          >
            {t("diagram.architecture.edgeOneWay")}
          </Button>
          <Button
            size="sm"
            variant={edge.bidi ? "secondary" : "ghost"}
            className="h-6 px-2 text-[11px]"
            onClick={() => onChangeBidi(true)}
          >
            {t("diagram.architecture.edgeBothWays")}
          </Button>
        </div>
        <Hint label={t("diagram.architecture.edgeReverseHint")}>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={edge.bidi}
            onClick={onReverse}
          >
            <ArrowLeftRight className="mr-1 size-3" />
            {t("diagram.architecture.edgeReverse")}
          </Button>
        </Hint>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("diagram.architecture.edgeHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.architecture.deleteEdgeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
