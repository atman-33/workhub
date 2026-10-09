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
import { formatUnit, type MatrixItem } from "@/lib/diagram/matrix2x2/parse";
import type { Sticky } from "@/lib/diagram/sticky";
import { useT } from "@/lib/i18n";
import type { Task } from "@/types";

/**
 * Edit panel for the selected item: the fields the canvas cannot express by
 * dragging or typing - colour, task link and the longer note.
 *
 * The item `id` is displayed but never editable: it is the handle the AI and
 * the file both use to identify the item. The fields are the shared ones from
 * `panel-frame`, which hold **no draft state**: every field renders straight
 * from `item`, so a rename or a drag on the canvas is reflected here
 * immediately.
 */
interface Props {
  item: MatrixItem;
  /** Tasks offered for the `task:` link. */
  tasks: Task[];
  disabled?: boolean;
  /** The sticky notes pinned to this item. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<MatrixItem>) => void;
  onDelete: () => void;
}

export function ItemEditor({
  item,
  tasks,
  disabled,
  stickies,
  stickiesHidden,
  onAddSticky,
  onChangeSticky,
  onDeleteSticky,
  onChange,
  onDelete,
}: Props) {
  const t = useT();
  const placed = item.x !== undefined && item.y !== undefined;

  return (
    <PanelFrame>
      <IdHeader
        id={item.id}
        copyHint={t("diagram.matrix.copyIdHint")}
        aside={
          placed && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("diagram.matrix.position", { x: formatUnit(item.x!), y: formatUnit(item.y!) })}
            </span>
          )
        }
      />
      {!placed && <p className="text-[11px] text-muted-foreground">{t("diagram.matrix.unplaced")}</p>}

      <TitleField
        value={item.title}
        placeholder={t("diagram.matrix.itemTitlePlaceholder")}
        disabled={disabled}
        onChange={(title) => onChange({ title })}
      />
      <NoteField
        value={item.note ?? ""}
        placeholder={t("diagram.matrix.itemNotePlaceholder")}
        disabled={disabled}
        onChange={(note) => onChange({ note })}
      />
      <ColorSwatches value={item.color} disabled={disabled} onChange={(color) => onChange({ color })} />
      <TaskSelect value={item.task} tasks={tasks} disabled={disabled} onChange={(task) => onChange({ task })} />

      <StickyList
        stickies={stickies}
        stickiesHidden={stickiesHidden}
        disabled={disabled}
        onAdd={onAddSticky}
        onChange={onChangeSticky}
        onDelete={onDeleteSticky}
      />

      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.matrix.deleteItemHint")} disabled={disabled} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
