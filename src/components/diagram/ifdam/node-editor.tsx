import {
  ColorSwatches,
  DeleteButton,
  IdHeader,
  PanelFrame,
  TaskSelect,
  TitleField,
} from "@/components/diagram/panel-frame";
import { DraftTextarea } from "@/components/diagram/ifdam/draft-field";
import { ScreenSections } from "@/components/diagram/ifdam/screen-sections";
import { StickyList } from "@/components/diagram/sticky-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { memoOf, type IfdamNode, type SectionKey } from "@/lib/diagram/ifdam/parse";
import { NODE_KINDS, symbolOfKind, type NodeKind } from "@/lib/diagram/ifdam/symbols";
import type { Sticky } from "@/lib/diagram/sticky";
import { useLocale, useT } from "@/lib/i18n";
import type { Task } from "@/types";

/**
 * Edit panel for the selected node: title, kind (from the symbol registry),
 * colour, linked task, the memo and the stickies pinned to it. A screen also
 * gets its three section editors (display / input / operation items). The id
 * is shown, never edited; the id does not fix the kind, so changing the kind
 * keeps the id (and the lines: see `patchNode`).
 */
interface Props {
  node: IfdamNode;
  tasks: Task[];
  /** The sticky notes pinned to this node. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<IfdamNode>) => void;
  onAddItem: (key: SectionKey, text: string) => void;
  onSetItem: (key: SectionKey, index: number, text: string) => void;
  onChangeMemo: (text: string) => void;
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
  onAddItem,
  onSetItem,
  onChangeMemo,
  onDelete,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const placed = node.x !== undefined && node.y !== undefined;

  return (
    <PanelFrame>
      <IdHeader
        id={node.id}
        copyHint={t("diagram.ifdam.copyIdHint")}
        aside={
          placed && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("diagram.ifdam.position", { x: node.x!, y: node.y! })}
            </span>
          )
        }
      />
      {!placed && (
        <p className="text-[11px] text-muted-foreground">{t("diagram.ifdam.autoPlaced")}</p>
      )}

      <TitleField
        value={node.title}
        placeholder={t("diagram.ifdam.nodeTitlePlaceholder")}
        onChange={(title) => onChange({ title })}
      />
      <Select value={node.kind} onValueChange={(v) => onChange({ kind: v as NodeKind })}>
        <SelectTrigger className="h-7 text-xs" aria-label={t("diagram.ifdam.kindLabel")}>
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
      {node.kind === "screen" && (
        <ScreenSections key={node.id} node={node} onAdd={onAddItem} onSet={onSetItem} />
      )}
      <DraftTextarea
        key={node.id}
        value={memoOf(node)}
        placeholder={t("diagram.ifdam.nodeNotePlaceholder")}
        onCommit={onChangeMemo}
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
        <DeleteButton hint={t("diagram.ifdam.deleteNodeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
