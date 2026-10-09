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
import type { PfdNode } from "@/lib/diagram/pfd/parse";
import { symbolOf } from "@/lib/diagram/pfd/symbols";
import type { Sticky } from "@/lib/diagram/sticky";
import { useLocale, useT } from "@/lib/i18n";
import type { Task } from "@/types";

/**
 * Edit panel for the selected node: title, colour, linked task, the longer
 * note and the stickies pinned to it. The id is shown, never edited - and with
 * it the kind of node, which the id's prefix fixes.
 *
 * Like the other element panels it holds no draft state; the shared fields
 * come from `panel-frame`.
 */
interface Props {
  node: PfdNode;
  tasks: Task[];
  /** The sticky notes pinned to this node. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<PfdNode>) => void;
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
  const symbol = symbolOf(node.id);

  return (
    <PanelFrame>
      <IdHeader
        id={node.id}
        copyHint={t("diagram.pfd.copyIdHint")}
        aside={
          <span className="font-mono text-[11px] text-muted-foreground">
            {symbol?.label[locale]}
            {placed && ` · ${t("diagram.pfd.position", { x: node.x!, y: node.y! })}`}
          </span>
        }
      />
      {!placed && <p className="text-[11px] text-muted-foreground">{t("diagram.pfd.autoPlaced")}</p>}

      <TitleField
        value={node.title}
        placeholder={t("diagram.pfd.nodeTitlePlaceholder")}
        onChange={(title) => onChange({ title })}
      />
      <NoteField
        value={node.note ?? ""}
        placeholder={t("diagram.pfd.nodeNotePlaceholder")}
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
        <DeleteButton hint={t("diagram.pfd.deleteNodeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
