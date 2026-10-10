import {
  ColorSwatches,
  DeleteButton,
  IdHeader,
  NONE,
  PanelFrame,
  TaskSelect,
  TitleField,
} from "@/components/diagram/panel-frame";
import { DraftTextarea } from "@/components/diagram/draft-field";
import { StickyList } from "@/components/diagram/sticky-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Sticky } from "@/lib/diagram/sticky";
import type { ArchitectureFrame, ArchitectureNode } from "@/lib/diagram/architecture/parse";
import { NODE_KINDS, symbolOfKind, type NodeKind } from "@/lib/diagram/architecture/symbols";
import { useLocale, useT } from "@/lib/i18n";
import type { Task } from "@/types";

/**
 * Edit panel for the selected block: title, kind (from the symbol registry),
 * frame, colour, linked task, the hover memo and the stickies pinned to it.
 * The id is shown, never edited; changing the kind keeps the id and the note
 * (see `setNodeKind`).
 */
interface Props {
  node: ArchitectureNode;
  frames: ArchitectureFrame[];
  tasks: Task[];
  /** The sticky notes pinned to this block. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<ArchitectureNode>) => void;
  onChangeMemo: (text: string) => void;
  onDelete: () => void;
}

export function NodeEditor({
  node,
  frames,
  tasks,
  stickies,
  stickiesHidden,
  onAddSticky,
  onChangeSticky,
  onDeleteSticky,
  onChange,
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
        copyHint={t("diagram.architecture.copyIdHint")}
        aside={
          placed && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("diagram.architecture.position", { x: node.x!, y: node.y! })}
            </span>
          )
        }
      />
      {!placed && (
        <p className="text-[11px] text-muted-foreground">{t("diagram.architecture.autoPlaced")}</p>
      )}

      <TitleField
        value={node.title}
        placeholder={t("diagram.architecture.nodeTitlePlaceholder")}
        onChange={(title) => onChange({ title })}
      />
      <Select value={node.kind} onValueChange={(v) => onChange({ kind: v as NodeKind })}>
        <SelectTrigger className="h-7 text-xs" aria-label={t("diagram.architecture.kindLabel")}>
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
      <Select
        value={node.frame ?? NONE}
        onValueChange={(v) => onChange({ frame: v === NONE ? undefined : v })}
      >
        <SelectTrigger className="h-7 text-xs" aria-label={t("diagram.architecture.frameLabel")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("diagram.architecture.frameNone")}</SelectItem>
          {frames.map((frame) => (
            <SelectItem key={frame.id} value={frame.id}>
              {frame.title ? `${frame.id} ${frame.title}` : frame.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DraftTextarea
        key={node.id}
        value={node.note ?? ""}
        placeholder={t("diagram.architecture.nodeNotePlaceholder")}
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
        <DeleteButton hint={t("diagram.architecture.deleteNodeHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
