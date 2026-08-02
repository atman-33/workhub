import { describe, expect, it } from "vitest";
import { parseSchedule, serializeSchedule, type SprintConfig } from "./parse";
import { defaultSprintStart, sprintNumberAt, sprintSlices, sprintSpan } from "./sprint";

const CFG: SprintConfig = { start: "2026-07-06", weeks: 2 };

const NOTE = `---
type: schedule
title: long-range plan
range: 2026-07-01..2026-12-31
sprint_start: 2026-07-06
sprint_weeks: 2
created: 2026-07-24
updated: 2026-07-24
---

## Non-working

- weekly: sat, sun

## Items

- [bar] I-001 2026-07-06..2026-08-14 build #blue

## Memo

kept as is
`;

describe("sprintNumberAt", () => {
  it("numbers from 1 at the cadence start", () => {
    expect(sprintNumberAt("2026-07-06", CFG)).toBe(1);
    expect(sprintNumberAt("2026-07-19", CFG)).toBe(1);
    expect(sprintNumberAt("2026-07-20", CFG)).toBe(2);
    expect(sprintNumberAt("2026-08-03", CFG)).toBe(3);
  });

  it("refuses to number days before the cadence starts", () => {
    expect(sprintNumberAt("2026-07-05", CFG)).toBeNull();
  });
});

describe("sprintSpan", () => {
  it("returns an inclusive span of the configured length", () => {
    expect(sprintSpan(1, CFG)).toEqual({ start: "2026-07-06", end: "2026-07-19" });
    expect(sprintSpan(3, CFG)).toEqual({ start: "2026-08-03", end: "2026-08-16" });
  });
});

describe("sprintSlices", () => {
  it("clips the sprints overlapping a window and marks the real edges", () => {
    const slices = sprintSlices("2026-07-10", "2026-08-05", CFG);
    expect(slices.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(slices[0]).toMatchObject({
      start: "2026-07-10",
      end: "2026-07-19",
      isStart: false,
      isEnd: true,
    });
    expect(slices[1]).toMatchObject({ start: "2026-07-20", isStart: true, isEnd: true });
    expect(slices[2]).toMatchObject({ end: "2026-08-05", isStart: true, isEnd: false });
  });

  it("produces nothing for the stretch before sprint 1", () => {
    expect(sprintSlices("2026-06-01", "2026-07-05", CFG)).toEqual([]);
  });
});

describe("defaultSprintStart", () => {
  it("backs up to the Sunday of the week, so boundaries meet the week columns", () => {
    // 2026-07-09 is a Thursday.
    expect(defaultSprintStart("2026-07-09")).toBe("2026-07-05");
    expect(defaultSprintStart("2026-07-05")).toBe("2026-07-05");
  });
});

describe("sprint frontmatter", () => {
  it("parses the cadence out of the note", () => {
    expect(parseSchedule(NOTE).sprint).toEqual({ start: "2026-07-06", weeks: 2 });
  });

  it("ignores a half-declared or out-of-range cadence", () => {
    expect(parseSchedule(NOTE.replace("sprint_weeks: 2\n", "")).sprint).toBeUndefined();
    expect(parseSchedule(NOTE.replace("sprint_weeks: 2", "sprint_weeks: 0")).sprint).toBeUndefined();
    expect(
      parseSchedule(NOTE.replace("sprint_start: 2026-07-06", "sprint_start: soon")).sprint,
    ).toBeUndefined();
  });

  it("round-trips an edited cadence and drops it when cleared", () => {
    const doc = parseSchedule(NOTE);
    const changed = serializeSchedule(NOTE, { ...doc, sprint: { start: "2026-07-13", weeks: 3 } }, "2026-08-02");
    expect(changed).toContain("sprint_start: 2026-07-13");
    expect(changed).toContain("sprint_weeks: 3");
    expect(changed).toContain("## Memo");

    const cleared = serializeSchedule(NOTE, { ...doc, sprint: undefined }, "2026-08-02");
    expect(cleared).not.toContain("sprint_start");
    expect(cleared).not.toContain("sprint_weeks");
    // Unmanaged keys and the human section survive either way.
    expect(cleared).toContain("title: long-range plan");
    expect(cleared).toContain("kept as is");
  });

  it("adds the cadence to a note that never had one", () => {
    const plain = NOTE.replace("sprint_start: 2026-07-06\nsprint_weeks: 2\n", "");
    const doc = parseSchedule(plain);
    const written = serializeSchedule(plain, { ...doc, sprint: CFG }, "2026-08-02");
    expect(parseSchedule(written).sprint).toEqual(CFG);
  });
});
