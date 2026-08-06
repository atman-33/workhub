import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  dueOccurrence,
  hasOpenTaskForRule,
  lastOccurrence,
  nextOccurrence,
  nextRuleId,
  newRule,
  ruleTag,
  taskInputFromRule,
} from "./recurring";
import type { RecurringRule, Task } from "@/types";

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  const base = newRule([]);
  return {
    ...base,
    title: "Daily standup",
    ...overrides,
    schedule: { ...base.schedule, start_date: "2026-01-01", ...(overrides.schedule ?? {}) },
  };
}

/** Local-time constructor so the tests read as wall-clock, like the rules do. */
function at(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min);
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "T-0001",
    title: "Daily standup",
    status: "todo",
    assignee: "me",
    project: "",
    priority: "medium",
    model: "",
    order: 1,
    due: "",
    tags: [],
    archived: false,
    confirm: false,
    worktree: false,
    blocked: false,
    blocked_note: "",
    blocked_since: "",
    created: "2026-07-30",
    updated: "2026-07-30",
    file: "C:/vault/tasks/T-0001 Daily standup.md",
    body: "",
    ...overrides,
  };
}

describe("daily schedules", () => {
  it("does not fire before the day's time", () => {
    const r = rule({ schedule: { ...newRule([]).schedule, time: "09:00", start_date: "2026-01-01" } });
    expect(lastOccurrence(r, at(2026, 7, 30, 8, 30))).toEqual(at(2026, 7, 29, 9, 0));
    expect(lastOccurrence(r, at(2026, 7, 30, 9, 0))).toEqual(at(2026, 7, 30, 9, 0));
  });

  it("honours an interval counted from the start date", () => {
    const r = rule({
      schedule: {
        ...newRule([]).schedule,
        kind: "daily",
        interval_days: 3,
        time: "09:00",
        start_date: "2026-07-01",
      },
    });
    // 07-01, 07-04, 07-07, ... — 07-30 is 29 days on, so the last fire is 07-28.
    expect(lastOccurrence(r, at(2026, 7, 30, 12, 0))).toEqual(at(2026, 7, 28, 9, 0));
    expect(nextOccurrence(r, at(2026, 7, 30, 12, 0))).toEqual(at(2026, 7, 31, 9, 0));
  });

  it("has no occurrence before the start date", () => {
    const r = rule({ schedule: { ...newRule([]).schedule, start_date: "2026-08-01" } });
    expect(lastOccurrence(r, at(2026, 7, 30, 23, 0))).toBeNull();
    expect(nextOccurrence(r, at(2026, 7, 30, 23, 0))).toEqual(at(2026, 8, 1, 9, 0));
  });
});

describe("weekly schedules", () => {
  const weekly = rule({
    schedule: {
      ...newRule([]).schedule,
      kind: "weekly",
      weekdays: [1, 4], // Mon, Thu
      time: "10:00",
      start_date: "2026-01-01",
    },
  });

  it("picks the most recent selected weekday", () => {
    // 2026-07-30 is a Thursday.
    expect(lastOccurrence(weekly, at(2026, 7, 30, 11, 0))).toEqual(at(2026, 7, 30, 10, 0));
    // Before the fire time on Thursday, the previous fire is Monday.
    expect(lastOccurrence(weekly, at(2026, 7, 30, 9, 0))).toEqual(at(2026, 7, 27, 10, 0));
  });

  it("previews the next selected weekday", () => {
    expect(nextOccurrence(weekly, at(2026, 7, 30, 11, 0))).toEqual(at(2026, 8, 3, 10, 0));
  });

  it("never fires with no weekday selected", () => {
    const none = rule({ schedule: { ...weekly.schedule, weekdays: [] } });
    expect(lastOccurrence(none, at(2026, 7, 30, 11, 0))).toBeNull();
    expect(nextOccurrence(none, at(2026, 7, 30, 11, 0))).toBeNull();
  });
});

describe("monthly schedules", () => {
  it("clamps the day to the end of shorter months", () => {
    const r = rule({
      schedule: {
        ...newRule([]).schedule,
        kind: "monthly",
        day_of_month: 31,
        time: "08:00",
        start_date: "2026-01-01",
      },
    });
    // February 2026 has 28 days.
    expect(lastOccurrence(r, at(2026, 3, 1, 0, 0))).toEqual(at(2026, 2, 28, 8, 0));
    expect(nextOccurrence(r, at(2026, 2, 10, 0, 0))).toEqual(at(2026, 2, 28, 8, 0));
  });

  it("falls back to the previous month before this month's day", () => {
    const r = rule({
      schedule: {
        ...newRule([]).schedule,
        kind: "monthly",
        day_of_month: 15,
        time: "08:00",
        start_date: "2026-01-01",
      },
    });
    expect(lastOccurrence(r, at(2026, 7, 3, 12, 0))).toEqual(at(2026, 6, 15, 8, 0));
    expect(nextOccurrence(r, at(2026, 7, 3, 12, 0))).toEqual(at(2026, 7, 15, 8, 0));
  });
});

describe("dueOccurrence", () => {
  const r = rule({ schedule: { ...newRule([]).schedule, time: "09:00", start_date: "2026-01-01" } });

  it("owes the 09:00 slot to an app started at 10:00", () => {
    expect(dueOccurrence(r, at(2026, 7, 30, 10, 0))).toEqual(at(2026, 7, 30, 9, 0));
  });

  it("catches up only the latest missed occurrence", () => {
    // Last fired four days ago; the one occurrence returned is today's.
    const stale = { ...r, last_generated: at(2026, 7, 26, 9, 0).getTime() / 1000 };
    expect(dueOccurrence(stale, at(2026, 7, 30, 10, 0))).toEqual(at(2026, 7, 30, 9, 0));
  });

  it("does not fire the same slot twice", () => {
    const fired = { ...r, last_generated: at(2026, 7, 30, 9, 0).getTime() / 1000 };
    expect(dueOccurrence(fired, at(2026, 7, 30, 10, 0))).toBeNull();
    expect(dueOccurrence(fired, at(2026, 7, 30, 23, 59))).toBeNull();
    // ...but the next day's slot is a new one.
    expect(dueOccurrence(fired, at(2026, 7, 31, 9, 0))).toEqual(at(2026, 7, 31, 9, 0));
  });

  it("ignores disabled rules", () => {
    expect(dueOccurrence({ ...r, enabled: false }, at(2026, 7, 30, 10, 0))).toBeNull();
  });
});

describe("open-task detection", () => {
  const r = rule({ id: "R-002" });

  it("sees an open task carrying the rule tag", () => {
    expect(hasOpenTaskForRule(r, [task({ tags: [ruleTag("R-002")] })])).toBe(true);
  });

  it("ignores done, archived and other rules' tasks", () => {
    const tasks = [
      task({ id: "T-1", status: "done", tags: [ruleTag("R-002")] }),
      task({ id: "T-2", archived: true, tags: [ruleTag("R-002")] }),
      task({ id: "T-3", tags: [ruleTag("R-003")] }),
      task({ id: "T-4", tags: [] }),
    ];
    expect(hasOpenTaskForRule(r, tasks)).toBe(false);
  });
});

describe("taskInputFromRule", () => {
  it("always tags the task with its rule and applies the due offset", () => {
    const r = rule({
      id: "R-007",
      title: "Weekly review",
      tags: ["routine"],
      due_offset_days: 2,
      priority: "high",
      assignee: "claude-code",
    });
    const input = taskInputFromRule(r, at(2026, 7, 30, 9, 0));
    expect(input.tags).toEqual(["recurring/R-007", "routine"]);
    expect(input.due).toBe("2026-08-01");
    expect(input.title).toBe("Weekly review");
    expect(input.priority).toBe("high");
    expect(input.assignee).toBe("claude-code");
  });

  it("leaves due empty when the rule has no offset", () => {
    expect(taskInputFromRule(rule({ due_offset_days: null }), at(2026, 7, 30, 9, 0)).due).toBe("");
  });

  it("falls back to the standard body when the rule has none", () => {
    expect(taskInputFromRule(rule({ body: "  " }), at(2026, 7, 30, 9, 0)).body).toBeUndefined();
  });
});

describe("rule ids", () => {
  it("never reuses an id", () => {
    expect(nextRuleId([])).toBe("R-001");
    expect(nextRuleId([{ ...rule({ id: "R-001" }) }, { ...rule({ id: "R-004" }) }])).toBe("R-005");
  });
});

describe("describeSchedule", () => {
  it("summarizes each kind", () => {
    expect(describeSchedule(rule())).toBe("Daily at 09:00");
    expect(describeSchedule(rule({ schedule: { ...newRule([]).schedule, interval_days: 3 } }))).toBe(
      "Every 3 days at 09:00",
    );
    expect(
      describeSchedule(rule({ schedule: { ...newRule([]).schedule, kind: "weekly", weekdays: [4, 1] } })),
    ).toBe("Weekly · Mon, Thu at 09:00");
    expect(
      describeSchedule(rule({ schedule: { ...newRule([]).schedule, kind: "monthly", day_of_month: 5 } })),
    ).toBe("Monthly · day 5 at 09:00");
  });
});
