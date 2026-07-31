import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { describeSchedule, newRule, nextOccurrence } from "@/lib/recurring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ModelCombobox } from "@/components/model-combobox";
import { cn } from "@/lib/utils";
import type { RecurringRule, TaskAssignee, TaskPriority, TaskStatus } from "@/types";

const STATUSES: TaskStatus[] = ["inbox", "todo", "doing"];
const ASSIGNEES: TaskAssignee[] = ["me", "claude-code", "opencode"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Same English-first formatting as the rest of the settings dialog. */
const TIMESTAMP = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

interface Props {
  rules: RecurringRule[];
  onChange: (rules: RecurringRule[]) => void;
  /** True while the hosting dialog is open (drives the model combobox). */
  open: boolean;
}

/**
 * The recurring-rule list editor (T-0110): a controlled component that edits a
 * draft array of rules. Persisting it — and running the rules — belongs to the
 * hosting dialog (`recurring-dialog.tsx`).
 */
export function RecurringSettings({ rules, onChange, open }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const patch = (id: string, changes: Partial<RecurringRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...changes } : r)));

  const patchSchedule = (id: string, changes: Partial<RecurringRule["schedule"]>) =>
    onChange(
      rules.map((r) => (r.id === id ? { ...r, schedule: { ...r.schedule, ...changes } } : r)),
    );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Rules the app turns into real tasks on their own schedule. Times are this machine's local
          clock; a missed occurrence (app closed) is created once at the next start, never
          backfilled.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => onChange([...rules, newRule(rules)])}
        >
          <Plus className="size-3.5" /> Add rule
        </Button>
      </div>

      {rules.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          No recurring rules yet.
        </p>
      )}

      {rules.map((rule) => {
        const isOpen = expanded === rule.id;
        const next = nextOccurrence(rule, new Date());
        return (
          <div key={rule.id} className="rounded-md border">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setExpanded(isOpen ? null : rule.id)}
              >
                {isOpen ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className={cn("truncate text-sm", !rule.enabled && "text-muted-foreground")}>
                    {rule.title.trim() || <span className="italic">Untitled rule</span>}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {rule.id} · {describeSchedule(rule)}
                    {rule.enabled && next ? ` · next ${TIMESTAMP.format(next)}` : ""}
                  </p>
                </div>
              </button>
              <Switch
                checked={rule.enabled}
                onCheckedChange={(v) => patch(rule.id, { enabled: v })}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>

            {isOpen && (
              <div className="space-y-3 border-t p-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Task title</label>
                  <Input
                    value={rule.title}
                    onChange={(e) => patch(rule.id, { title: e.target.value })}
                    placeholder="Weekly review"
                    className="h-8 text-xs"
                  />
                </div>

                {/* Schedule */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Repeat</label>
                    <Select
                      value={rule.schedule.kind}
                      onValueChange={(v) => patchSchedule(rule.id, { kind: v })}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Time</label>
                    <Input
                      type="time"
                      value={rule.schedule.time}
                      onChange={(e) => patchSchedule(rule.id, { time: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                {rule.schedule.kind === "daily" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Every N days (counted from the start date)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={rule.schedule.interval_days}
                      onChange={(e) =>
                        patchSchedule(rule.id, {
                          interval_days: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="h-8 w-24 text-xs"
                    />
                  </div>
                )}

                {rule.schedule.kind === "weekly" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Weekdays</label>
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAYS.map((label, day) => {
                        const on = rule.schedule.weekdays.includes(day);
                        return (
                          <Button
                            key={label}
                            type="button"
                            size="sm"
                            variant={on ? "default" : "outline"}
                            className="h-7 px-2 text-[11px]"
                            onClick={() =>
                              patchSchedule(rule.id, {
                                weekdays: on
                                  ? rule.schedule.weekdays.filter((d) => d !== day)
                                  : [...rule.schedule.weekdays, day].sort((a, b) => a - b),
                              })
                            }
                          >
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {rule.schedule.kind === "monthly" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Day of month (clamped in shorter months)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={rule.schedule.day_of_month}
                      onChange={(e) =>
                        patchSchedule(rule.id, {
                          day_of_month: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                      className="h-8 w-24 text-xs"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Start date</label>
                    <Input
                      type="date"
                      value={rule.schedule.start_date}
                      onChange={(e) => patchSchedule(rule.id, { start_date: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Due offset (days)
                    </label>
                    <Input
                      type="number"
                      value={rule.due_offset_days ?? ""}
                      placeholder="no due date"
                      onChange={(e) =>
                        patch(rule.id, {
                          due_offset_days:
                            e.target.value === "" ? null : Number(e.target.value) || 0,
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                {/* Generated task's frontmatter */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <Select
                      value={rule.status}
                      onValueChange={(v) => patch(rule.id, { status: v })}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Assignee</label>
                    <Select
                      value={rule.assignee}
                      // Model ids are per-CLI, so a leftover id would be passed
                      // to the wrong agent's --model.
                      onValueChange={(v) => patch(rule.id, { assignee: v, model: "" })}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNEES.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Priority</label>
                    <Select
                      value={rule.priority}
                      onValueChange={(v) => patch(rule.id, { priority: v })}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Project</label>
                    <Input
                      value={rule.project}
                      onChange={(e) => patch(rule.id, { project: e.target.value })}
                      placeholder="repo / project slug"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Model</label>
                    <ModelCombobox
                      assignee={rule.assignee as TaskAssignee}
                      value={rule.model}
                      onChange={(model) => patch(rule.id, { model })}
                      active={open}
                      disabled={rule.assignee === "me"}
                      placeholder={rule.assignee === "me" ? "n/a for me" : "agent default"}
                      modal
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Extra tags (comma separated)
                  </label>
                  <Input
                    value={rule.tags.join(", ")}
                    onChange={(e) =>
                      patch(rule.id, {
                        tags: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="routine"
                    className="h-8 text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Every generated task also carries <code>recurring/{rule.id}</code>, which is how
                    the app recognizes its own tasks.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Task body</label>
                  <Textarea
                    value={rule.body}
                    onChange={(e) => patch(rule.id, { body: e.target.value })}
                    placeholder={"## Description\n\n## Plan\n\n## Results"}
                    className="min-h-24 font-mono text-xs"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs">Skip while the last one is still open</p>
                    <p className="text-[11px] text-muted-foreground">
                      Don't create the task again while an earlier one from this rule is not done.
                      The occurrence is still marked as handled, so it won't pile up later.
                    </p>
                  </div>
                  <Switch
                    checked={rule.skip_if_open}
                    onCheckedChange={(v) => patch(rule.id, { skip_if_open: v })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs">Plan first (confirm)</span>
                    <Switch
                      checked={rule.confirm}
                      onCheckedChange={(v) => patch(rule.id, { confirm: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs">Git worktree</span>
                    <Switch
                      checked={rule.worktree}
                      onCheckedChange={(v) => patch(rule.id, { worktree: v })}
                    />
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Last generated:{" "}
                  {rule.last_generated
                    ? TIMESTAMP.format(new Date(rule.last_generated * 1000))
                    : "never"}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
