import { Input } from "@/components/ui/input";
import type { LabelField } from "@/lib/diagram/matrix2x2/parse";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages/en";

/**
 * The axis and quadrant names, edited in the side panel while no item is
 * selected. They live in the note's frontmatter; an empty one is not drawn.
 */
interface Props {
  labels: Record<LabelField, string>;
  disabled?: boolean;
  onChange: (field: LabelField, value: string) => void;
}

interface Row {
  field: LabelField;
  label: MessageKey;
}

const X_ROWS: Row[] = [
  { field: "xAxis", label: "diagram.matrix.axisName" },
  { field: "xLow", label: "diagram.matrix.lowEnd" },
  { field: "xHigh", label: "diagram.matrix.highEnd" },
];
const Y_ROWS: Row[] = [
  { field: "yAxis", label: "diagram.matrix.axisName" },
  { field: "yLow", label: "diagram.matrix.lowEndY" },
  { field: "yHigh", label: "diagram.matrix.highEndY" },
];
const Q_ROWS: Row[] = [
  { field: "qTl", label: "diagram.matrix.qTl" },
  { field: "qTr", label: "diagram.matrix.qTr" },
  { field: "qBl", label: "diagram.matrix.qBl" },
  { field: "qBr", label: "diagram.matrix.qBr" },
];

export function LabelsEditor({ labels, disabled, onChange }: Props) {
  const t = useT();
  const group = (title: MessageKey, rows: Row[]) => (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-[11px] font-medium text-muted-foreground">{t(title)}</legend>
      {rows.map((row) => (
        <label key={row.field} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{t(row.label)}</span>
          <Input
            value={labels[row.field]}
            disabled={disabled}
            className="h-7 text-xs"
            onChange={(e) => onChange(row.field, e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
      ))}
    </fieldset>
  );
  return (
    <div className="shrink-0 space-y-3 border-b p-3 text-xs">
      <div>
        <p className="font-medium">{t("diagram.matrix.labelsTitle")}</p>
        <p className="text-[11px] text-muted-foreground">{t("diagram.matrix.labelsHint")}</p>
      </div>
      {group("diagram.matrix.xAxis", X_ROWS)}
      {group("diagram.matrix.yAxis", Y_ROWS)}
      {group("diagram.matrix.quadrants", Q_ROWS)}
    </div>
  );
}
