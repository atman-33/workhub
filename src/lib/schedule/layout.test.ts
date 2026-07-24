import { describe, expect, it } from "vitest";
import { exportScheduleHtml } from "./export";
import {
  buildLayout,
  calendarDays,
  countWorkingDays,
  dayDelta,
  isNonWorking,
  isWeeklyNonWorking,
  parseRange,
  shiftDate,
  toggleNonWorkingDay,
} from "./layout";
import {
  formatItem,
  nextItemId,
  parseSchedule,
  serializeSchedule,
  type ScheduleDocModel,
} from "./parse";

const NOTE = `---
type: schedule
title: 2026Q3 release plan
range: 2026-07-20..2026-08-31
owner: someone
created: 2026-07-24
updated: 2026-07-24
---

## Non-working

- weekly: sat, sun
- 2026-08-11 Mountain Day
- 2026-08-13..2026-08-15 summer leave

## Items

- [bar] I-001 2026-07-21..2026-08-07 implementation #blue task:T-0090
- [bar] I-002 2026-08-08..2026-08-19 integration test #amber
- [milestone] I-003 2026-08-20 release review #red
- [note] I-004 2026-07-31 monthly review 15:00

## Memo

Free-form prose neither the app nor the AI rewrites.
`;

describe("parseSchedule", () => {
  it("reads the frontmatter, non-working days and every element kind", () => {
    const doc = parseSchedule(NOTE);
    expect(doc.title).toBe("2026Q3 release plan");
    expect(doc.range).toBe("2026-07-20..2026-08-31");
    // sat = 6, sun = 0, sorted ascending.
    expect(doc.nonWorking.weekly).toEqual([0, 6]);
    expect(doc.nonWorking.ranges).toEqual([
      { start: "2026-08-11", end: "2026-08-11", label: "Mountain Day" },
      { start: "2026-08-13", end: "2026-08-15", label: "summer leave" },
    ]);
    expect(doc.items).toHaveLength(4);
    expect(doc.items[0]).toEqual({
      kind: "bar",
      id: "I-001",
      start: "2026-07-21",
      end: "2026-08-07",
      title: "implementation",
      color: "blue",
      task: "T-0090",
    });
    expect(doc.items[2]).toMatchObject({ kind: "milestone", start: "2026-08-20", end: "2026-08-20" });
    // A note's title keeps its inner spaces; only the modifiers are stripped.
    expect(doc.items[3].title).toBe("monthly review 15:00");
    expect(doc.rawItems).toEqual([]);
  });

  it("keeps unparsable lines instead of dropping them", () => {
    const broken = NOTE.replace(
      "- [note] I-004 2026-07-31 monthly review 15:00",
      "- [note] I-004 not-a-date monthly review\n- something a human typed",
    );
    const doc = parseSchedule(broken);
    expect(doc.items).toHaveLength(3);
    expect(doc.rawItems).toEqual([
      "- [note] I-004 not-a-date monthly review",
      "- something a human typed",
    ]);
    // And they survive a round trip.
    expect(serializeSchedule(broken, doc, "2026-07-25")).toContain("- something a human typed");
  });

  it("keeps a reversed bar range as a raw line rather than rendering it", () => {
    const reversed = NOTE.replace("2026-07-21..2026-08-07", "2026-08-07..2026-07-21");
    const doc = parseSchedule(reversed);
    expect(doc.items.map((i) => i.id)).not.toContain("I-001");
    expect(doc.rawItems[0]).toContain("I-001");
  });
});

describe("continuation lines (element body)", () => {
  const WITH_BODY = NOTE.replace(
    "- [note] I-004 2026-07-31 monthly review 15:00",
    "- [note] I-004 2026-07-31 monthly review\n  15:00-16:00 room A\n  bring the deck",
  );

  it("attaches indented lines to the element above them", () => {
    const doc = parseSchedule(WITH_BODY);
    const note = doc.items.find((i) => i.id === "I-004");
    expect(note?.title).toBe("monthly review");
    expect(note?.body).toBe("15:00-16:00 room A\nbring the deck");
    // The continuation is not mistaken for an unparsable line.
    expect(doc.rawItems).toEqual([]);
    // Neighbouring elements are unaffected.
    expect(doc.items.find((i) => i.id === "I-003")?.body).toBeUndefined();
  });

  it("round-trips a body without disturbing the rest of the file", () => {
    const doc = parseSchedule(WITH_BODY);
    const out = serializeSchedule(WITH_BODY, doc, "2026-07-25");
    expect(out).toContain("- [note] I-004 2026-07-31 monthly review\n  15:00-16:00 room A\n  bring the deck");
    expect(out).toContain("Free-form prose neither the app nor the AI rewrites.");
    expect(parseSchedule(out).items).toEqual(doc.items);
  });

  it("carries the body along when the element moves", () => {
    const doc = parseSchedule(WITH_BODY);
    const note = doc.items.find((i) => i.id === "I-004");
    if (!note) throw new Error("missing I-004");
    note.start = "2026-08-03";
    note.end = "2026-08-03";
    const out = serializeSchedule(WITH_BODY, doc, "2026-07-25");
    expect(out).toContain("- [note] I-004 2026-08-03 monthly review\n  15:00-16:00 room A");
    expect(parseSchedule(out).items.find((i) => i.id === "I-004")?.body).toBe(
      "15:00-16:00 room A\nbring the deck",
    );
  });

  it("works on any kind, so a bar can carry a remark", () => {
    const withBar = NOTE.replace(
      "- [bar] I-002 2026-08-08..2026-08-19 integration test #amber",
      "- [bar] I-002 2026-08-08..2026-08-19 integration test #amber\n  QA lead is away the first week",
    );
    const bar = parseSchedule(withBar).items.find((i) => i.id === "I-002");
    expect(bar?.title).toBe("integration test");
    expect(bar?.color).toBe("amber");
    expect(bar?.body).toBe("QA lead is away the first week");
  });

  it("keeps a continuation that follows an unparsable line as raw", () => {
    // There is no element to attach it to, so the "nothing is ever dropped"
    // guarantee has to carry it instead.
    const broken = NOTE.replace(
      "- [note] I-004 2026-07-31 monthly review 15:00",
      "- [note] I-004 not-a-date monthly review\n  a stranded continuation",
    );
    const doc = parseSchedule(broken);
    expect(doc.rawItems).toEqual([
      "- [note] I-004 not-a-date monthly review",
      "  a stranded continuation",
    ]);
    expect(serializeSchedule(broken, doc, "2026-07-25")).toContain("  a stranded continuation");
  });

  it("emits no continuation lines for an empty body", () => {
    expect(
      formatItem({ kind: "note", id: "I-009", start: "2026-08-01", end: "2026-08-01", title: "x" }),
    ).toBe("- [note] I-009 2026-08-01 x");
    expect(
      formatItem({
        kind: "note",
        id: "I-009",
        start: "2026-08-01",
        end: "2026-08-01",
        title: "x",
        body: "  \n ",
      }),
    ).toBe("- [note] I-009 2026-08-01 x");
  });
});

describe("serializeSchedule", () => {
  it("preserves the memo, unmanaged frontmatter keys and element ids", () => {
    const doc = parseSchedule(NOTE);
    doc.items[0].start = "2026-07-28";
    doc.items[0].end = "2026-08-14";
    const out = serializeSchedule(NOTE, doc, "2026-07-25");

    expect(out).toContain("owner: someone");
    expect(out).toContain("Free-form prose neither the app nor the AI rewrites.");
    expect(out).toContain("- [bar] I-001 2026-07-28..2026-08-14 implementation #blue task:T-0090");
    expect(out).toContain("updated: 2026-07-25");
    expect(out).not.toContain("updated: 2026-07-24");
  });

  it("round-trips an unchanged document to an equivalent document", () => {
    const once = serializeSchedule(NOTE, parseSchedule(NOTE), "2026-07-24");
    const twice = serializeSchedule(once, parseSchedule(once), "2026-07-24");
    expect(twice).toBe(once);
    expect(parseSchedule(once).items).toEqual(parseSchedule(NOTE).items);
  });

  it("writes a milestone with a single date and a bar with a range", () => {
    expect(
      formatItem({ kind: "milestone", id: "I-009", start: "2026-08-20", end: "2026-08-20", title: "x" }),
    ).toBe("- [milestone] I-009 2026-08-20 x");
    expect(
      formatItem({ kind: "bar", id: "I-009", start: "2026-08-01", end: "2026-08-03", title: "x" }),
    ).toBe("- [bar] I-009 2026-08-01..2026-08-03 x");
  });
});

describe("nextItemId", () => {
  it("continues past the highest existing id and never reuses one", () => {
    const doc = parseSchedule(NOTE);
    expect(nextItemId(doc.items)).toBe("I-005");
    // Deleting the last element must not hand its id back out.
    expect(nextItemId(doc.items.slice(0, 2))).toBe("I-003");
    expect(nextItemId([])).toBe("I-001");
  });
});

describe("countWorkingDays", () => {
  const nw = parseSchedule(NOTE).nonWorking;

  it("excludes weekends and explicitly listed days", () => {
    // Mon 2026-07-20 .. Sun 2026-07-26: five weekdays.
    expect(countWorkingDays("2026-07-20", "2026-07-26", nw)).toBe(5);
    // The week holding Mountain Day (Tue 8/11) loses a sixth day.
    expect(countWorkingDays("2026-08-10", "2026-08-16", nw)).toBe(2);
  });

  it("counts a single day, and zero for an all-non-working span", () => {
    expect(countWorkingDays("2026-07-20", "2026-07-20", nw)).toBe(1);
    // Sat + Sun.
    expect(countWorkingDays("2026-07-25", "2026-07-26", nw)).toBe(0);
    // Reversed spans are empty rather than an error.
    expect(countWorkingDays("2026-07-26", "2026-07-20", nw)).toBe(0);
  });

  it("agrees with isNonWorking on the boundaries of a listed range", () => {
    expect(isNonWorking("2026-08-12", nw)).toBe(false);
    expect(isNonWorking("2026-08-13", nw)).toBe(true);
    expect(isNonWorking("2026-08-15", nw)).toBe(true);
    // 8/16 is a Sunday, so it is non-working for the weekly rule instead.
    expect(isNonWorking("2026-08-17", nw)).toBe(false);
  });
});

describe("buildLayout", () => {
  const doc = parseSchedule(NOTE);

  it("emits whole Sunday-start weeks covering the range", () => {
    const layout = buildLayout(doc, "2026-07-22", "2026-08-05");
    expect(layout.weeks[0].days[0].weekday).toBe(0);
    expect(layout.weeks[0].days).toHaveLength(7);
    // 7/22 is a Wednesday, so its week starts Sunday 7/19 — before the range.
    expect(layout.weeks[0].days[0].date).toBe("2026-07-19");
    expect(layout.weeks[0].days[0].isOutside).toBe(true);
    expect(layout.weeks[0].days[3].isOutside).toBe(false);
    expect(layout.weeks.at(-1)?.days.some((d) => d.date === "2026-08-05")).toBe(true);
  });

  it("marks the month boundary on the day rather than breaking the run", () => {
    const layout = buildLayout(doc, "2026-07-26", "2026-08-01");
    // One continuous week row spans the month change.
    expect(layout.weeks).toHaveLength(1);
    const aug1 = layout.weeks[0].days.find((d) => d.date === "2026-08-01");
    expect(aug1?.isMonthStart).toBe(true);
    expect(layout.weeks[0].days.find((d) => d.date === "2026-07-31")?.isMonthStart).toBe(false);
    // Most of this week is in July, so the gutter reports month 7. The label
    // itself is the renderer's business (see i18n.ts).
    expect(layout.weeks[0].gutterMonth).toBe(7);
  });

  it("clips a multi-week bar into one segment per week", () => {
    const layout = buildLayout(doc, "2026-07-20", "2026-08-09");
    const segments = layout.weeks.flatMap((w) => w.bars.filter((b) => b.item.id === "I-001"));
    // 7/21 (Tue) .. 8/7 (Fri) touches three Sunday-start week rows.
    expect(segments).toHaveLength(3);
    // Sunday is column 0, so Tuesday 7/21 starts at column 2.
    expect(segments[0]).toMatchObject({ startCol: 2, endCol: 6, isStart: true, isEnd: false });
    expect(segments[1]).toMatchObject({ startCol: 0, endCol: 6, isStart: false, isEnd: false });
    // Friday 8/7 is column 5.
    expect(segments[2]).toMatchObject({ startCol: 0, endCol: 5, isStart: false, isEnd: true });
    // Every segment reports the whole bar's working days, not the segment's.
    const whole = countWorkingDays("2026-07-21", "2026-08-07", doc.nonWorking);
    expect(segments.every((s) => s.workingDays === whole)).toBe(true);
  });

  it("stacks overlapping bars into separate lanes and leaves disjoint ones alone", () => {
    const overlapping: ScheduleDocModel = {
      ...doc,
      items: [
        { kind: "bar", id: "I-101", start: "2026-07-20", end: "2026-07-24", title: "a" },
        { kind: "bar", id: "I-102", start: "2026-07-22", end: "2026-07-26", title: "b" },
        { kind: "bar", id: "I-103", start: "2026-07-25", end: "2026-07-26", title: "c" },
      ],
    };
    const week = buildLayout(overlapping, "2026-07-19", "2026-07-25").weeks[0];
    expect(week.lanes).toBe(2);
    const lane = (id: string) => week.bars.find((b) => b.item.id === id)?.lane;
    expect(lane("I-101")).toBe(0);
    expect(lane("I-102")).toBe(1);
    // I-103 starts after I-101 ends, so it reuses the top lane.
    expect(lane("I-103")).toBe(0);
  });

  it("places point elements on their own day only", () => {
    const layout = buildLayout(doc, "2026-07-26", "2026-08-01");
    const days = layout.weeks[0].days;
    expect(days.find((d) => d.date === "2026-07-31")?.points.map((p) => p.id)).toEqual(["I-004"]);
    expect(days.find((d) => d.date === "2026-07-30")?.points).toEqual([]);
    // Bars never leak into the point buckets.
    expect(days.every((d) => d.points.every((p) => p.kind !== "bar"))).toBe(true);
  });

  it("carries the non-working label onto the day", () => {
    const layout = buildLayout(doc, "2026-08-09", "2026-08-15");
    const days = layout.weeks[0].days;
    expect(days.find((d) => d.date === "2026-08-11")?.nonWorkingLabel).toBe("Mountain Day");
    expect(days.find((d) => d.date === "2026-08-14")?.nonWorkingLabel).toBe("summer leave");
    // A weekend is non-working but carries no label.
    const sunday = days.find((d) => d.date === "2026-08-09");
    expect(sunday?.isNonWorking).toBe(true);
    expect(sunday?.nonWorkingLabel).toBeUndefined();
  });

  it("returns no weeks for a reversed range", () => {
    expect(buildLayout(doc, "2026-08-05", "2026-07-20").weeks).toEqual([]);
  });
});

describe("toggleNonWorkingDay", () => {
  const nw = parseSchedule(NOTE).nonWorking;

  it("adds a plain working day", () => {
    // Thu 2026-08-06 is a working day; clicking it makes it non-working.
    const next = toggleNonWorkingDay(nw, "2026-08-06");
    expect(next.ranges).toContainEqual({ start: "2026-08-06", end: "2026-08-06", label: "" });
    expect(isNonWorking("2026-08-06", next)).toBe(true);
  });

  it("removes a single-day entry outright", () => {
    const next = toggleNonWorkingDay(nw, "2026-08-11");
    expect(next.ranges.some((r) => r.start === "2026-08-11")).toBe(false);
    expect(isNonWorking("2026-08-11", next)).toBe(false);
  });

  it("splits a multi-day entry rather than dropping the whole thing", () => {
    // Taking 8/14 back out of "8/13..8/15 summer leave" must leave 8/13 and
    // 8/15 off — cancelling the entire leave would be a much bigger edit than
    // the one click asked for.
    const next = toggleNonWorkingDay(nw, "2026-08-14");
    expect(next.ranges).toContainEqual({
      start: "2026-08-13",
      end: "2026-08-13",
      label: "summer leave",
    });
    expect(next.ranges).toContainEqual({
      start: "2026-08-15",
      end: "2026-08-15",
      label: "summer leave",
    });
    expect(isNonWorking("2026-08-14", next)).toBe(false);
    expect(isNonWorking("2026-08-13", next)).toBe(true);
    expect(isNonWorking("2026-08-15", next)).toBe(true);
  });

  it("trims an edge day without splitting", () => {
    const next = toggleNonWorkingDay(nw, "2026-08-13");
    expect(next.ranges).toContainEqual({
      start: "2026-08-14",
      end: "2026-08-15",
      label: "summer leave",
    });
    expect(isNonWorking("2026-08-13", next)).toBe(false);
  });

  it("leaves a weekly-rule day untouched, identity included", () => {
    // The notation has no "working exception", so the grid must be able to
    // detect a no-op and say why instead of writing a redundant entry.
    expect(isWeeklyNonWorking("2026-08-16", nw)).toBe(true);
    expect(toggleNonWorkingDay(nw, "2026-08-16")).toBe(nw);
    expect(isWeeklyNonWorking("2026-08-06", nw)).toBe(false);
  });
});

describe("dayDelta", () => {
  it("measures whole days in both directions, across week and month edges", () => {
    // What makes a drag able to cross a week row: one row down is +7.
    expect(dayDelta("2026-07-20", "2026-07-27")).toBe(7);
    expect(dayDelta("2026-07-27", "2026-07-20")).toBe(-7);
    expect(dayDelta("2026-07-31", "2026-08-01")).toBe(1);
    expect(dayDelta("2026-07-20", "2026-07-20")).toBe(0);
  });
});

describe("exportScheduleHtml", () => {
  const html = exportScheduleHtml(parseSchedule(NOTE), {
    start: "2026-07-20",
    end: "2026-08-31",
    today: "2026-07-24",
    locale: "en",
  });

  it("references nothing outside the file", () => {
    // The whole point of the export: it opens on a machine with no network
    // and no relationship to this app.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/url\(/i);
  });

  it("carries the print rules a PDF hand-off depends on", () => {
    expect(html).toContain("@page { size: A4 landscape");
    expect(html).toContain("break-inside: avoid");
  });

  it("renders the same elements the layout produced", () => {
    expect(html).toContain("2026Q3 release plan");
    expect(html).toContain("implementation");
    expect(html).toContain("release review");
    // Non-working labels reach the page, and titles are escaped on the way.
    expect(html).toContain("Mountain Day");
    const escaped = exportScheduleHtml(
      { ...parseSchedule(NOTE), title: "<b>plan</b> & co" },
      { start: "2026-07-20", end: "2026-07-26", today: "2026-07-24", locale: "en" },
    );
    expect(escaped).toContain("&lt;b&gt;plan&lt;/b&gt; &amp; co");
    expect(escaped).not.toContain("<b>plan</b>");
  });

  it("reports the window's working-day count in the header", () => {
    const doc = parseSchedule(NOTE);
    const days = countWorkingDays("2026-07-20", "2026-08-31", doc.nonWorking);
    expect(html).toContain(`${days} working days`);
  });

  it("lists note text in the footer, since paper has no hover", () => {
    expect(html).toContain("Notes");
    expect(html).toContain("monthly review 15:00");
    // The note is not also drawn inside its day cell.
    expect(html).not.toContain('class="dot note"');
    // Its day still carries the corner marker.
    expect(html).toContain('class="marker"');

    // A schedule with no notes gets no Notes section at all.
    const noNotes = parseSchedule(NOTE.replace(/^- \[note\].*$/m, ""));
    const out = exportScheduleHtml(noNotes, {
      start: "2026-07-20",
      end: "2026-08-31",
      today: "2026-07-24",
      locale: "en",
    });
    expect(out).not.toContain("<h2>Notes</h2>");
  });

  it("marks non-working days with a glyph, not shading alone", () => {
    // Shading is easy to lose on a printed page, and on screen it competes
    // with the selection tint — the mark is what actually says "non-working".
    expect(html).toContain('<span class="nwmark">&#10005;</span>');
    const marks = html.match(/class="nwmark"/g) ?? [];
    const working = countWorkingDays("2026-07-20", "2026-08-31", parseSchedule(NOTE).nonWorking);
    // Every rendered day is either working or marked. Week rows are whole, so
    // the grid also holds days outside the window; the mark count must at
    // least cover the non-working days inside it.
    expect(marks.length).toBeGreaterThanOrEqual(calendarDays("2026-07-20", "2026-08-31") - working);
  });

  it("keeps a note's continuation lines in the footer list", () => {
    const withBody = parseSchedule(
      NOTE.replace(
        "- [note] I-004 2026-07-31 monthly review 15:00",
        "- [note] I-004 2026-07-31 monthly review\n  15:00-16:00 room A",
      ),
    );
    const out = exportScheduleHtml(withBody, {
      start: "2026-07-20",
      end: "2026-08-31",
      today: "2026-07-24",
      locale: "en",
    });
    expect(out).toContain("monthly review\n15:00-16:00 room A");
    // `pre-wrap` is what makes that newline visible rather than collapsed.
    expect(out).toContain("white-space: pre-wrap");
  });

  it("follows the locale for weekday, month and header text", () => {
    const ja = exportScheduleHtml(parseSchedule(NOTE), {
      start: "2026-07-20",
      end: "2026-08-31",
      today: "2026-07-24",
      locale: "ja",
    });
    expect(ja).toContain('<html lang="ja">');
    expect(ja).toContain("<th>日</th>");
    expect(ja).toContain("出力日 2026-07-24");
    expect(ja).toContain("非稼働日");
    expect(ja).not.toContain("<th>Sun</th>");
    // English is unchanged, and the schedule content is identical either way.
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<th>Sun</th>");
    expect(ja).toContain("implementation");
  });
});

describe("parseRange / shiftDate", () => {
  it("accepts a well-formed range and rejects everything else", () => {
    expect(parseRange("2026-07-20..2026-08-31")).toEqual({
      start: "2026-07-20",
      end: "2026-08-31",
    });
    expect(parseRange("")).toBeNull();
    expect(parseRange("2026-07-20")).toBeNull();
    expect(parseRange("2026-08-31..2026-07-20")).toBeNull();
  });

  it("shifts across month and year boundaries", () => {
    expect(shiftDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-07-20", 0)).toBe("2026-07-20");
  });
});
