import { describe, expect, it } from "vitest";
import { scheduleExportSvg, SCHEDULE_IMAGE_WIDTH } from "./export-image";
import type { ScheduleDocModel } from "./parse";

function docWith(items: ScheduleDocModel["items"]): ScheduleDocModel {
  return {
    title: "Plan & review <Q3>",
    range: "2026-10-05..2026-10-18",
    nonWorking: { weekly: [0, 6], ranges: [] },
    items,
    rawItems: [],
    rawNonWorking: [],
  };
}

const BAR = {
  kind: "bar" as const,
  id: "I-001",
  start: "2026-10-06",
  end: "2026-10-09",
  title: "Build it",
  color: "blue" as const,
};

describe("scheduleExportSvg", () => {
  it("wraps the export drawing in a sized SVG foreignObject", () => {
    const svg = scheduleExportSvg(docWith([BAR]), {
      start: "2026-10-05",
      end: "2026-10-18",
      today: "2026-10-11",
      locale: "en",
    });
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain(`width="${SCHEDULE_IMAGE_WIDTH}"`);
    expect(svg).toMatch(/height="\d+"/);
    // The drawing travels with its styles and content.
    expect(svg).toContain("<style>");
    expect(svg).toContain("Build it");
  });

  it("emits XML-safe entities and the escaped title", () => {
    const svg = scheduleExportSvg(docWith([BAR]), {
      start: "2026-10-05",
      end: "2026-10-18",
      today: "2026-10-11",
      locale: "en",
    });
    expect(svg).not.toContain("&middot;");
    expect(svg).toContain("Plan &amp; review &lt;Q3&gt;");
  });

  it("grows with the window and supports the timeline mode", () => {
    const one = scheduleExportSvg(docWith([BAR]), {
      start: "2026-10-05",
      end: "2026-10-11",
      today: "2026-10-11",
      locale: "en",
    });
    const two = scheduleExportSvg(docWith([BAR]), {
      start: "2026-10-05",
      end: "2026-10-18",
      today: "2026-10-11",
      locale: "en",
    });
    const heightOf = (svg: string) => Number(/height="(\d+)"/.exec(svg)?.[1] ?? 0);
    expect(heightOf(two)).toBeGreaterThan(heightOf(one));
    const timeline = scheduleExportSvg(docWith([BAR]), {
      start: "2026-10-05",
      end: "2026-10-18",
      today: "2026-10-11",
      locale: "en",
      mode: "timeline",
    });
    expect(timeline).toContain("<foreignObject");
    expect(heightOf(timeline)).toBeGreaterThan(0);
  });
});
