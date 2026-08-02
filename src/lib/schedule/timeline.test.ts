import { describe, expect, it } from "vitest";
import { exportScheduleHtml } from "./export";
import { panWindow, panWindowDays } from "./layout";
import { parseSchedule } from "./parse";
import { buildTimeline, dateAtFrac, snapWeeks, timelineUnit } from "./timeline";

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
- 2026-08-11 Mountain Day

## Items

- [bar] I-001 2026-07-06..2026-08-14 implementation #blue
- [bar] I-002 2026-08-17..2026-09-25 integration test #amber
- [arrow] I-003 2026-07-06..2026-11-30 vendor lead time #gray
- [milestone] I-004 2026-09-30 release review #red
- [note] I-005 2026-07-31 monthly review

## Memo

untouched
`;

const doc = parseSchedule(NOTE);

describe("timelineUnit", () => {
  it("uses week columns up to about a quarter and months beyond it", () => {
    expect(timelineUnit("2026-07-01", "2026-09-30")).toBe("week");
    expect(timelineUnit("2026-07-01", "2026-12-31")).toBe("month");
  });
});

describe("buildTimeline", () => {
  it("returns an empty layout for an inverted window", () => {
    const layout = buildTimeline(doc, "2026-08-01", "2026-07-01");
    expect(layout.columns).toEqual([]);
    expect(layout.bars).toEqual([]);
  });

  it("covers the window with columns whose fractions tile it exactly", () => {
    const layout = buildTimeline(doc, "2026-07-01", "2026-12-31");
    expect(layout.unit).toBe("month");
    expect(layout.columns).toHaveLength(6);
    expect(layout.columns[0]).toMatchObject({ month: 7, year: 2026, startFrac: 0 });
    const total = layout.columns.reduce((sum, c) => sum + c.widthFrac, 0);
    expect(total).toBeCloseTo(1, 10);
    // Columns are clipped to the window, never spilling past it.
    expect(layout.columns.at(-1)?.end).toBe("2026-12-31");
  });

  it("clips a week column that the window starts inside", () => {
    // 2026-07-01 is a Wednesday, so the first week column starts on 06-28.
    const layout = buildTimeline(doc, "2026-07-01", "2026-08-31");
    expect(layout.unit).toBe("week");
    expect(layout.columns[0]).toMatchObject({ start: "2026-07-01", startFrac: 0, days: 4 });
  });

  it("counts working days per column, honouring holidays", () => {
    const layout = buildTimeline(doc, "2026-08-10", "2026-08-16");
    // Mon-Fri minus Mountain Day on the 11th.
    expect(layout.columns[0].workingDays).toBe(4);
    expect(layout.workingDays).toBe(4);
  });

  it("places a bar as a fraction of the window, covering its whole last day", () => {
    const layout = buildTimeline(doc, "2026-07-01", "2026-07-10");
    const bar = layout.bars.find((b) => b.item.id === "I-001");
    expect(bar).toMatchObject({ isStart: true, isEnd: false, start: "2026-07-06", end: "2026-07-10" });
    expect(bar?.startFrac).toBeCloseTo(5 / 10, 10);
    expect(bar?.widthFrac).toBeCloseTo(5 / 10, 10);
    // Working days are counted over the whole element, not the visible part:
    // six working weeks from 07-06 to 08-14, less Mountain Day.
    expect(bar?.workingDays).toBe(29);
  });

  it("stacks overlapping range elements and keeps sequential ones on one lane", () => {
    const layout = buildTimeline(doc, "2026-07-01", "2026-12-31");
    const lane = (id: string) => layout.bars.find((b) => b.item.id === id)?.lane;
    expect(lane("I-001")).toBe(0);
    // I-002 starts after I-001 ends, so it reuses the top lane.
    expect(lane("I-002")).toBe(0);
    // The arrow spans both, so it has to move down.
    expect(lane("I-003")).toBe(1);
    expect(layout.laneCount).toBe(2);
  });

  it("keeps point elements out of the bar lanes", () => {
    const layout = buildTimeline(doc, "2026-07-01", "2026-12-31");
    expect(layout.points.map((p) => p.item.id)).toEqual(["I-005", "I-004"]);
    expect(layout.pointLaneCount).toBe(1);
    expect(layout.bars.every((b) => b.item.kind === "bar" || b.item.kind === "arrow")).toBe(true);
  });

  it("gives close point elements their own lane so labels do not collide", () => {
    const crowded = parseSchedule(
      NOTE.replace(
        "- [note] I-005 2026-07-31 monthly review",
        "- [note] I-005 2026-09-29 kickoff",
      ),
    );
    const layout = buildTimeline(crowded, "2026-07-01", "2026-12-31");
    expect(layout.pointLaneCount).toBe(2);
  });

  it("slices the sprints across the window and positions them on the axis", () => {
    const layout = buildTimeline(doc, "2026-07-01", "2026-08-31");
    expect(layout.sprints[0]).toMatchObject({ number: 1, start: "2026-07-06", isStart: true });
    expect(layout.sprints[0].startFrac).toBeCloseTo(5 / 62, 10);
    expect(layout.sprints.at(-1)?.end).toBe("2026-08-31");
  });

  it("draws no sprint band when the note declares no cadence", () => {
    const plain = parseSchedule(NOTE.replace("sprint_start: 2026-07-06\nsprint_weeks: 2\n", ""));
    expect(buildTimeline(plain, "2026-07-01", "2026-08-31").sprints).toEqual([]);
  });

  it("bands the columns by month in week mode and by year in month mode", () => {
    const weeks = buildTimeline(doc, "2026-07-01", "2026-08-31");
    expect(weeks.bands.map((b) => b.month)).toEqual([7, 8]);
    const months = buildTimeline(doc, "2026-11-01", "2027-02-28");
    expect(months.bands.map((b) => b.label)).toEqual(["2026", "2027"]);
  });

  it("positions today only when it falls inside the window", () => {
    expect(buildTimeline(doc, "2026-07-01", "2026-07-10", "2026-07-06")?.todayFrac).toBeCloseTo(
      0.5,
      10,
    );
    expect(buildTimeline(doc, "2026-07-01", "2026-07-10", "2026-08-06").todayFrac).toBeNull();
    expect(buildTimeline(doc, "2026-07-01", "2026-07-10").todayFrac).toBeNull();
  });
});

describe("dateAtFrac", () => {
  const layout = buildTimeline(doc, "2026-07-01", "2026-07-10");

  it("inverts the axis back to a day", () => {
    expect(dateAtFrac(layout, 0)).toBe("2026-07-01");
    expect(dateAtFrac(layout, 0.55)).toBe("2026-07-06");
    expect(dateAtFrac(layout, 1)).toBe("2026-07-10");
  });

  it("clamps a pointer that left the track", () => {
    expect(dateAtFrac(layout, -3)).toBe("2026-07-01");
    expect(dateAtFrac(layout, 9)).toBe("2026-07-10");
  });
});

describe("exportScheduleHtml in timeline mode", () => {
  const html = exportScheduleHtml(doc, {
    start: "2026-07-01",
    end: "2026-12-31",
    today: "2026-08-02",
    locale: "en",
    mode: "timeline",
  });

  it("references nothing outside the file", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/url\(/i);
  });

  it("keeps the print rules a PDF hand-off depends on", () => {
    expect(html).toContain("@page { size: A4 landscape");
  });

  it("draws the timeline rather than the week grid", () => {
    expect(html).toContain('class="timeline"');
    expect(html).toContain('class="tplot"');
    expect(html).not.toContain('class="grid"');
  });

  it("carries every element, the sprint band and today", () => {
    expect(html).toContain("implementation");
    expect(html).toContain("vendor lead time");
    expect(html).toContain("release review");
    expect(html).toContain("S1");
    expect(html).toContain('class="ttoday"');
  });

  it("escapes user text", () => {
    const escaped = exportScheduleHtml(
      { ...doc, title: "<b>plan</b> & co" },
      { start: "2026-07-01", end: "2026-12-31", today: "2026-08-02", locale: "en", mode: "timeline" },
    );
    expect(escaped).toContain("&lt;b&gt;plan&lt;/b&gt; &amp; co");
    expect(escaped).not.toContain("<b>plan</b>");
  });

  it("still exports the calendar when no mode is given", () => {
    const fallback = exportScheduleHtml(doc, {
      start: "2026-07-01",
      end: "2026-07-31",
      today: "2026-08-02",
      locale: "en",
    });
    expect(fallback).toContain('class="grid"');
    expect(fallback).not.toContain('class="timeline"');
  });
});

describe("panWindowDays", () => {
  const win = { start: "2026-07-01", end: "2026-07-10" };

  it("moves the whole window, keeping its length", () => {
    expect(panWindowDays(win, 3)).toEqual({ start: "2026-07-04", end: "2026-07-13" });
    expect(panWindowDays(win, -1)).toEqual({ start: "2026-06-30", end: "2026-07-09" });
  });

  it("returns the same window for a zero move, so a still pointer is free", () => {
    expect(panWindowDays(win, 0)).toBe(win);
  });

  it("agrees with the week-quantized pan the calendar uses", () => {
    expect(panWindow(win, 2)).toEqual(panWindowDays(win, 14));
  });
});

describe("snapWeeks", () => {
  it("rounds a drag to whole weeks", () => {
    expect(snapWeeks(0)).toBe(0);
    expect(snapWeeks(3)).toBe(0);
    expect(snapWeeks(4)).toBe(7);
    expect(snapWeeks(-10)).toBe(-7);
  });
});
