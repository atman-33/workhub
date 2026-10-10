import { DeleteButton, NoteField, PanelFrame, TitleField } from "@/components/diagram/panel-frame";
import type { QuadrantKey } from "@/lib/diagram/matrix2x2/quadrant-notes";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages/en";

/**
 * Edit panel for the selected quadrant (T-0692): its name, which the canvas
 * draws as a watermark, and its note - the longer "what is this quadrant, and
 * what do we do about it" that has no place on the canvas.
 *
 * The name field is here because a selected quadrant replaces the labels panel,
 * which is where the name is otherwise edited. Like the other panels it holds
 * no draft state: both fields render straight from the model.
 */
interface Props {
  quadrant: QuadrantKey;
  name: string;
  note: string;
  disabled?: boolean;
  onChangeName: (name: string) => void;
  onChangeNote: (note: string) => void;
  onClearNote: () => void;
}

export const QUADRANT_POSITION_KEY: Record<QuadrantKey, MessageKey> = {
  tl: "diagram.matrix.qTl",
  tr: "diagram.matrix.qTr",
  bl: "diagram.matrix.qBl",
  br: "diagram.matrix.qBr",
};

export function QuadrantEditor({
  quadrant,
  name,
  note,
  disabled,
  onChangeName,
  onChangeNote,
  onClearNote,
}: Props) {
  const t = useT();
  return (
    <PanelFrame>
      <p className="font-medium">
        {t("diagram.matrix.quadrantTitle", { position: t(QUADRANT_POSITION_KEY[quadrant]) })}
      </p>
      <TitleField
        value={name}
        placeholder={t("diagram.matrix.quadrantNamePlaceholder")}
        disabled={disabled}
        onChange={onChangeName}
      />
      <NoteField
        value={note}
        rows={10}
        placeholder={t("diagram.matrix.quadrantNotePlaceholder")}
        disabled={disabled}
        onChange={onChangeNote}
      />
      <p className="text-[11px] text-muted-foreground">{t("diagram.matrix.quadrantNoteHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <DeleteButton
          hint={t("diagram.matrix.quadrantNoteClearHint")}
          disabled={disabled || !note.trim()}
          onClick={onClearNote}
        />
      </div>
    </PanelFrame>
  );
}
