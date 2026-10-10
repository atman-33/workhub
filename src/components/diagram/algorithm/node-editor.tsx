import {
  ColorSwatches,
  DeleteButton,
  IdHeader,
  NoteField,
  PanelFrame,
  TaskSelect,
  TitleField,
} from "@/components/diagram/panel-frame";
import { StickyList } from "@/components/diagram/sticky-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AlgorithmNode } from "@/lib/diagram/algorithm/parse";
import { NODE_KINDS, symbolOfKind, type NodeKind } from "@/lib/diagram/algorithm/symbols";
import type { Sticky } from "@/lib/diagram/sticky";
import { useLocale, useT } from "@/lib/i18n";
import type { Task } from "@/types";

/**
 * Edit panel for the selected node: title, kind (from the symbol registry),
 * colour, linked task, the longer note and the stickies pinned to it. The id
 * is shown, never edited; unlike a PFD node, the id does not fix the kind, so
 * changing the kind keeps the id.
 */
interface Props {
  node: AlgorithmNode;
  tasks: Task[];
  /** The sticky notes pinned to this node. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<AlgorithmNode>) => void;
  onDelete: () => void;
}

export function NodeEditor({
  node,
  tasks,
  stickies,
  stickiesHidden,
  onAddSticky,
  onChangeSticky,
  onDeleteSticky,
  onChange,
  onDelete,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const placed = node.x !== undefined && node.y !== undefined;

  return (
    <PanelFrame>
      <IdHeader
        id={node.id}
        copyHint={t("diagram.algorithm.copyIdHint")}
        aside={
          placed && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("diagram.algorithm.position", { x: node.x!, y: node.y! })}
            </span>
          )
        }
      />
      {!placed && (
        <p className="text-[11px] text-muted-foreground">{t("diagram.algorithm.autoPlaced")}</p>
      )}

      <TitleField
        value={node.title}
        placeholder={t("diagram.algorithm.nodeTitlePlaceholder")}
        onChange={(title) => onChange({ title })}
      />
      <Select value={node.kind} onValueChange={(v) => onChange({ kind: v as NodeKind })}>
        <SelectTrigger className="h-7 text-xs" aria-label={t("diagram.algorithm.kindLabel")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NODE_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {symbolOfKind(kind).label[locale]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <NoteField
        value={node.note ?? ""}
        placeholder={t("diagram.algorithm.nodeNotePlaceholder")}
        onChange={(note) => onChange({ note })}
      />
      <ColorSwatches value={node.color} onChange={(color) => onChange({ color })} />
      <TaskSelect value={node.task} tasks={tasks} onChange={(task) => onChange({ task })} />

      <StickyList
        stickies={stickies}
        stickiesHidden={stickiesHidden}
        onAdd={onAddSticky}
        onChange={onChangeSticky}
        onDelete={onDeleteSticky}
      />

      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.algorithm.deleteNodeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
