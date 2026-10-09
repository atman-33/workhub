import {
  ColorSwatches,
  DeleteButton,
  IdHeader,
  NONE,
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
import {
  STEP_KINDS,
  type FlowLane,
  type FlowStep,
  type StepKind,
} from "@/lib/diagram/flow/parse";
import type { Sticky } from "@/lib/diagram/sticky";
import { useT, type MessageKey } from "@/lib/i18n";
import type { Task } from "@/types";

const KIND_LABEL: Record<StepKind, MessageKey> = {
  process: "diagram.flow.kind.process",
  start: "diagram.flow.kind.start",
  end: "diagram.flow.kind.end",
  decision: "diagram.flow.kind.decision",
};

/**
 * Edit panel for the selected step: title, kind, lane, colour, linked task,
 * the longer note and the stickies pinned to it. The id is shown, never edited.
 *
 * Like the other element panels it holds no draft state; the shared fields
 * come from `panel-frame`.
 */
interface Props {
  step: FlowStep;
  lanes: FlowLane[];
  tasks: Task[];
  /** The sticky notes pinned to this step. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<FlowStep>) => void;
  /** Moves the step to a lane (`undefined`: the unassigned band). */
  onChangeLane: (lane: string | undefined) => void;
  onDelete: () => void;
}

export function StepEditor({
  step,
  lanes,
  tasks,
  stickies,
  stickiesHidden,
  onAddSticky,
  onChangeSticky,
  onDeleteSticky,
  onChange,
  onChangeLane,
  onDelete,
}: Props) {
  const t = useT();
  const placed = step.x !== undefined && step.y !== undefined;
  const laneValue = step.lane && lanes.some((l) => l.id === step.lane) ? step.lane : NONE;

  return (
    <PanelFrame>
      <IdHeader
        id={step.id}
        copyHint={t("diagram.flow.copyIdHint")}
        aside={
          placed && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("diagram.flow.position", { x: step.x!, y: step.y! })}
            </span>
          )
        }
      />
      {!placed && <p className="text-[11px] text-muted-foreground">{t("diagram.flow.autoPlaced")}</p>}

      <TitleField
        value={step.title}
        placeholder={t("diagram.flow.stepTitlePlaceholder")}
        onChange={(title) => onChange({ title })}
      />

      <div className="grid grid-cols-2 gap-1.5">
        <Select value={step.kind} onValueChange={(v) => onChange({ kind: v as StepKind })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STEP_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(KIND_LABEL[kind])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={laneValue}
          onValueChange={(v) => onChangeLane(v === NONE ? undefined : v)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("diagram.flow.unassigned")}</SelectItem>
            {lanes.map((lane) => (
              <SelectItem key={lane.id} value={lane.id}>
                {lane.title || lane.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <NoteField
        value={step.note ?? ""}
        placeholder={t("diagram.flow.stepNotePlaceholder")}
        onChange={(note) => onChange({ note })}
      />
      <ColorSwatches value={step.color} onChange={(color) => onChange({ color })} />
      <TaskSelect value={step.task} tasks={tasks} onChange={(task) => onChange({ task })} />

      <StickyList
        stickies={stickies}
        stickiesHidden={stickiesHidden}
        onAdd={onAddSticky}
        onChange={onChangeSticky}
        onDelete={onDeleteSticky}
      />

      <div className="flex flex-wrap gap-1.5">
        <DeleteButton hint={t("diagram.flow.deleteStepHint")} onClick={onDelete} />
      </div>
    </PanelFrame>
  );
}
