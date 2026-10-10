import {
  ColorSwatches,
  DeleteButton,
  IdHeader,
  PanelFrame,
  TaskSelect,
  TitleField,
} from "@/components/diagram/panel-frame";
import { DraftTextarea } from "@/components/diagram/draft-field";
import { ActionList } from "@/components/diagram/usecase/action-list";
import { StickyList } from "@/components/diagram/sticky-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Sticky } from "@/lib/diagram/sticky";
import type { UsecaseNode } from "@/lib/diagram/usecase/parse";
import { NODE_KINDS, symbolOfKind, type NodeKind } from "@/lib/diagram/usecase/symbols";
import { useLocale, useT } from "@/lib/i18n";
import type { Task } from "@/types";

/**
 * Edit panel for the selected node: title, kind (from the symbol registry),
 * colour, linked task, the note and the stickies pinned to it. For a person the
 * note is their list of actions (one field per item: the speech bubble), for
 * anything else a memo shown on hover. The id is shown, never edited; changing
 * the kind keeps the id and the note (see `setNodeKind`).
 */
interface Props {
  node: UsecaseNode;
  tasks: Task[];
  /** The sticky notes pinned to this node. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<UsecaseNode>) => void;
  onAddAction: (text: string) => void;
  onSetAction: (index: number, text: string) => void;
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
  onAddAction,
  onSetAction,
  onChangeMemo,
  onDelete,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const placed = node.x !== undefined && node.y !== undefined;
  const person = symbolOfKind(node.kind).bubble;

  return (
    <PanelFrame>
      <IdHeader
        id={node.id}
        copyHint={t("diagram.usecase.copyIdHint")}
        aside={
          placed && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("diagram.usecase.position", { x: node.x!, y: node.y! })}
            </span>
          )
        }
      />
      {!placed && (
        <p className="text-[11px] text-muted-foreground">{t("diagram.usecase.autoPlaced")}</p>
      )}

      <TitleField
        value={node.title}
        placeholder={t("diagram.usecase.nodeTitlePlaceholder")}
        onChange={(title) => onChange({ title })}
      />
      <Select value={node.kind} onValueChange={(v) => onChange({ kind: v as NodeKind })}>
        <SelectTrigger className="h-7 text-xs" aria-label={t("diagram.usecase.kindLabel")}>
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
      {person ? (
        <ActionList key={node.id} node={node} onAdd={onAddAction} onSet={onSetAction} />
      ) : (
        <DraftTextarea
          key={node.id}
          value={node.note ?? ""}
          placeholder={t("diagram.usecase.nodeNotePlaceholder")}
          onCommit={onChangeMemo}
        />
      )}
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
        <DeleteButton hint={t("diagram.usecase.deleteNodeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
