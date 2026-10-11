/**
 * A schedule's export drawing as an SVG wrapper, for "Copy image" (T-0725
 * part A).
 *
 * Unlike the other diagram kinds the schedule has no export SVG: its drawing
 * is HTML (`exportScheduleHtml` — the same string the HTML file export writes
 * to disk). This module wraps that string in an SVG `foreignObject` so the
 * shared `copySvgAsPng` pipeline can rasterize it without a second renderer.
 * No layout is duplicated: the body comes straight from `exportScheduleHtml`,
 * and the height estimate below only reuses `buildLayout` / `buildTimeline`
 * (the same calls the screen and the export make) to size the frame.
 *
 * Two XML details matter because the wrapper is parsed as XML inside an
 * `<img>`: the inner content carries the XHTML namespace, and the one named
 * HTML entity the export emits (`&middot;`) is rewritten to its numeric
 * form — every other `&` the export produces is already `&amp;`/`&lt;`/
 * `&gt;`/`&quot;`, which are valid XML.
 */

import { exportScheduleHtml, type ExportOptions } from "./export";
import { buildLayout } from "./layout";
import { buildTimeline } from "./timeline";
import type { ScheduleDocModel } from "./parse";

/** Width the schedule is drawn at, in px — about A4 landscape at screen dpi. */
export const SCHEDULE_IMAGE_WIDTH = 1200;

export type ScheduleImageOptions = ExportOptions;

function extractTag(html: string, tag: "style" | "body"): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(html);
  return match?.[1] ?? "";
}

/**
 * Frames the export drawing for `copySvgAsPng`. The height is an estimate
 * from the layout (a clipped tail on a very note-heavy plan is possible —
 * the file export stays the exact record); the width is fixed.
 */
export function scheduleExportSvg(doc: ScheduleDocModel, options: ScheduleImageOptions): string {
  const html = exportScheduleHtml(doc, options);
  const style = extractTag(html, "style");
  const body = extractTag(html, "body").replace(/&middot;/g, "&#183;");
  const { start, end, today, mode = "calendar" } = options;

  // Chrome around the drawing: header, weekday/month headings and footer.
  // Kept generous rather than exact — surplus is blank page, shortage clips.
  const CHROME = 260;
  let drawing: number;
  if (mode === "timeline") {
    const tl = buildTimeline(doc, start, end, today);
    const plot = Math.max(tl.laneCount, 1) * 22 + tl.pointLaneCount * 16 + 8;
    drawing = 18 + 16 + (tl.sprints.length > 0 ? 14 : 0) + plot;
  } else {
    const layout = buildLayout(doc, start, end, today);
    drawing = layout.weeks.reduce((sum, week) => {
      const deepest = Math.max(
        0,
        ...week.days.map((d) => d.points.filter((p) => p.kind !== "note").length),
      );
      return sum + Math.max(96, 20 + week.lanes * 18 + deepest * 14 + 8);
    }, 0);
  }
  const width = SCHEDULE_IMAGE_WIDTH;
  const height = Math.ceil(CHROME + drawing);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:24px;font-family:sans-serif;background:#fff;">` +
    `<style>${style}</style>${body}</div>` +
    `</foreignObject></svg>`
  );
}
