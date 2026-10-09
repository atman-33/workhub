import { CornerDownRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
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
import { AttrEditor } from "./attr-editor";
import { useT } from "@/lib/i18n";
import { type MindmapNode, type Sticky } from "@/lib/mindmap/parse";
import type { Task } from "@/types";

/**
 * Edit panel for the selected node: the fields the canvas cannot express by
 * dragging or typing — colour, task link, and the longer note.
 *
 * The node `id` is displayed but never editable. It is the handle the AI and
 * the file both use to identify the node; reassigning it would silently break
 * the link between a map's history and the thing it describes.
 *
 * Like the schedule's item editor, this panel holds **no draft state**: every
 * field renders straight from `node`, so an inline rename or a re-parent on
 * the canvas is reflected here immediately rather than being served stale from
 * a local copy. The common fields are the shared ones in `panel-frame`.
 */

interface Props {
  node: MindmapNode;
  /** Tasks of the current project, offered for the `task:` link. */
  tasks: Task[];
  /** Attribute keys used anywhere in this map, offered as suggestions. The
   * vocabulary is the map's own — keys are not configured anywhere. */
  attrKeys: string[];
  /** Values used for one key anywhere in this map. */
  attrValuesFor: (key: string) => string[];
  /** The note's chip order, which the attribute rows are listed in and which
   * dragging one of them changes. It belongs to the map, not to this node. */
  attrChips: "all" | string[];
  onAttrChipsChange: (chips: "all" | string[]) => void;
  disabled?: boolean;
  /** The sticky notes pinned to this node. */
  stickies: Sticky[];
  /** True while the note hides every sticky — an added one would land
   * somewhere invisible, so the panel says so. */
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<MindmapNode>) => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onDelete: () => void;
}

export function NodeEditor({
  node,
  tasks,
  attrKeys,
  attrValuesFor,
  attrChips,
  onAttrChipsChange,
  disabled,
  stickies,
  stickiesHidden,
  onAddSticky,
  onChangeSticky,
  onDeleteSticky,
  onChange,
  onAddChild,
  onAddSibling,
  onDelete,
}: Props) {
  const t = useT();
  const childCount = node.children.length;

  return (
    <PanelFrame>
      <IdHeader
        id={node.id}
        copyHint={t("mindmap.nodeEditor.copyIdHint")}
        aside={
          childCount > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {t(
                childCount === 1 ? "mindmap.nodeEditor.childCountOne" : "mindmap.nodeEditor.childCountOther",
                { count: childCount },
              )}
            </span>
          )
        }
      />

      <TitleField
        value={node.title}
        placeholder={t("mindmap.nodeEditor.titlePlaceholder")}
        disabled={disabled}
        onChange={(title) => onChange({ title })}
      />
      <NoteField
        value={node.note ?? ""}
        placeholder={t("mindmap.nodeEditor.notePlaceholder")}
        disabled={disabled}
        onChange={(note) => onChange({ note })}
      />
      <ColorSwatches value={node.color} disabled={disabled} onChange={(color) => onChange({ color })} />
      <TaskSelect value={node.task} tasks={tasks} disabled={disabled} onChange={(task) => onChange({ task })} />

      <AttrEditor
        attrs={node.attrs}
        knownKeys={attrKeys}
        valuesFor={attrValuesFor}
        chips={attrChips}
        onChipsChange={onAttrChipsChange}
        disabled={disabled}
        onChange={(attrs) => onChange({ attrs })}
      />

      <StickyList
        stickies={stickies}
        stickiesHidden={stickiesHidden}
        disabled={disabled}
        onAdd={onAddSticky}
        onChange={onChangeSticky}
        onDelete={onDeleteSticky}
      />

      <div className="flex flex-wrap gap-1.5">
        <Hint label={t("mindmap.nodeEditor.addChildHint")} disabled={disabled}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={onAddChild}
          >
            <CornerDownRight className="mr-1 size-3" />
            {t("mindmap.nodeEditor.child")}
          </Button>
        </Hint>
        <Hint label={t("mindmap.nodeEditor.addSiblingHint")} disabled={disabled}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={onAddSibling}
          >
            <Plus className="mr-1 size-3" />
            {t("mindmap.nodeEditor.sibling")}
          </Button>
        </Hint>
        <DeleteButton
          hint={
            childCount > 0
              ? t("mindmap.nodeEditor.deleteWithDescendantsHint", { count: childCount })
              : t("mindmap.nodeEditor.deleteHint")
          }
          disabled={disabled}
          onClick={onDelete}
        />
      </div>
    </PanelFrame>
  );
}
