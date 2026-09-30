import { X } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Hint } from "@/components/ui/hint";
import { useT } from "@/lib/i18n";
import { TASK_STATUS_LABEL_KEY } from "@/lib/i18n/labels";
import { dependencyCandidates } from "@/lib/task-dependencies";
import type { Task } from "@/types";

interface Props {
  /** Id of the task being edited; empty while a new task is still a draft. */
  taskId: string;
  /** Current predecessor ids. */
  value: string[];
  /** Every task on the board, archived included. */
  tasks: readonly Task[];
  onChange: (next: string[]) => void;
}

/**
 * Picks the tasks that must be done before this one can start.
 *
 * Shows the current predecessors as removable chips and offers every other
 * task that would not close a loop as the next one to add. The loop check
 * lives in the candidate list rather than in an error after the fact: a task
 * that cannot be chosen cannot be mistyped.
 */
export function TaskDependsOnField({ taskId, value, tasks, onChange }: Props) {
  const t = useT();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const candidates = dependencyCandidates(taskId, value, tasks);
  const details = Object.fromEntries(
    candidates.map((c) => [
      c.id,
      { label: c.title, meta: t(TASK_STATUS_LABEL_KEY[c.status]) },
    ]),
  );

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {value.map((id) => {
            const dep = byId.get(id);
            const done = dep?.status === "done";
            return (
              <li
                key={id}
                className="flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px]"
              >
                <span className="shrink-0 font-mono">{id}</span>
                <span className="truncate text-muted-foreground">
                  {dep ? dep.title : t("taskEditor.field.dependsOnUnknown")}
                </span>
                {dep && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {done ? "✓ " : ""}
                    {t(TASK_STATUS_LABEL_KEY[dep.status])}
                  </span>
                )}
                <Hint label={t("taskEditor.field.dependsOnRemove", { id })}>
                  <button
                    type="button"
                    aria-label={t("taskEditor.field.dependsOnRemove", { id })}
                    className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                    onClick={() => onChange(value.filter((v) => v !== id))}
                  >
                    <X className="size-3" />
                  </button>
                </Hint>
              </li>
            );
          })}
        </ul>
      )}
      <Combobox
        value=""
        onChange={(id) => {
          if (id) onChange([...value, id]);
        }}
        options={candidates.map((c) => c.id)}
        optionDetails={details}
        placeholder={t("taskEditor.field.dependsOnAdd")}
        emptyText={t("taskEditor.field.dependsOnEmpty")}
        className="h-8 text-xs"
      />
    </div>
  );
}
