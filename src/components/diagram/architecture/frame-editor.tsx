import {
  ColorSwatches,
  DeleteButton,
  IdHeader,
  PanelFrame,
  TitleField,
} from "@/components/diagram/panel-frame";
import { DraftTextarea } from "@/components/diagram/draft-field";
import { StickyList } from "@/components/diagram/sticky-list";
import type { Sticky } from "@/lib/diagram/sticky";
import type { ArchitectureFrame } from "@/lib/diagram/architecture/parse";
import { useT } from "@/lib/i18n";

/**
 * Edit panel for the selected frame: title, colour, the hover memo and the
 * stickies pinned to it. The members are edited where they are (blocks, or the
 * frame choice in a block's panel); deleting the frame leaves them where they
 * are, outside every frame. The id is shown, never edited.
 */
interface Props {
  frame: ArchitectureFrame;
  /** How many blocks sit in this frame. */
  memberCount: number;
  /** The sticky notes pinned to this frame. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<ArchitectureFrame>) => void;
  onChangeMemo: (text: string) => void;
  onDelete: () => void;
}

export function FrameEditor({
  frame,
  memberCount,
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

  return (
    <PanelFrame>
      <IdHeader id={frame.id} copyHint={t("diagram.architecture.copyIdHint")} />

      <TitleField
        value={frame.title}
        placeholder={t("diagram.architecture.frameTitlePlaceholder")}
        onChange={(title) => onChange({ title })}
      />
      <p className="text-[11px] text-muted-foreground">
        {t("diagram.architecture.frameMembers", { count: memberCount })}
      </p>
      <DraftTextarea
        key={frame.id}
        value={frame.note ?? ""}
        placeholder={t("diagram.architecture.frameNotePlaceholder")}
        onCommit={onChangeMemo}
      />
      <ColorSwatches value={frame.color} onChange={(color) => onChange({ color })} />

      <StickyList
        stickies={stickies}
        stickiesHidden={stickiesHidden}
        onAdd={onAddSticky}
        onChange={onChangeSticky}
        onDelete={onDeleteSticky}
      />

      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.architecture.deleteFrameHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
