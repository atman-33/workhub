/**
 * Static HTML export of a schedule (T-0090).
 *
 * Two hard requirements shape this file (design note §8.1):
 *
 * 1. **Single file, no external references.** No CDN stylesheet, no webfont,
 *    no image, no script. The export is emailed and opened on machines with
 *    no network and no relationship to this app; anything fetched would render
 *    as a blank box there.
 * 2. **Same layout as the screen.** It renders `buildLayout`'s output — the
 *    same call the React grid makes — so an approved plan cannot export as a
 *    different plan.
 *
 * The output is deliberately inert: no JavaScript at all, so it opens under
 * any policy and "Print → Save as PDF" is the whole distribution story.
 */

import { monthLabel, strings, type ScheduleLocale } from "./i18n";
import { buildLayout, countWorkingDays, type Layout } from "./layout";
import { COLOR_HEX, type ScheduleDocModel, type ScheduleItem } from "./parse";

/** Minimal HTML escaping for the user-authored strings that go into the page
 * (titles, labels). Kept local rather than pulled from a library: the export
 * must stay dependency-free at runtime, and this is the entire surface. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function itemColor(item: ScheduleItem): string {
  return item.color ? COLOR_HEX[item.color] : COLOR_HEX.gray;
}

/**
 * Print styling lives here rather than in a shared stylesheet because the
 * export is the only surface that is ever printed. A4 landscape matches the
 * grid's aspect ratio, and `break-inside: avoid` on week rows is what stops a
 * bar from being sliced in half across a page break (§8.3).
 */
function styles(): string {
  return `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  font-family: "Segoe UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  font-size: 12px; color: #111827; background: #fff;
}
header { margin-bottom: 16px; }
h1 { margin: 0 0 4px; font-size: 18px; }
.meta { color: #6b7280; font-size: 11px; }
table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.grid th {
  padding: 4px 6px; font-size: 11px; font-weight: 600; color: #6b7280;
  border-bottom: 1px solid #d1d5db; text-align: left;
}
th.gutter, td.gutter { width: 44px; color: #6b7280; font-size: 11px; text-align: right; padding-right: 8px; }
tr.week { break-inside: avoid; page-break-inside: avoid; }
td.dayrow { padding: 0; border-bottom: 1px solid #e5e7eb; }
table.days { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.days td { width: 14.285%; vertical-align: top; padding: 0; }
.daynum { padding: 3px 5px; font-size: 11px; font-variant-numeric: tabular-nums; }
.nonworking { background: #f3f4f6; color: #9ca3af; }
.outside { color: #d1d5db; }
.monthstart { font-weight: 700; border-left: 2px solid #9ca3af; }
.nwlabel { display: block; font-size: 9px; color: #9ca3af; padding: 0 5px 2px; }
.lanes { padding: 0 0 4px; }
.lane { position: relative; height: 18px; }
.bar {
  position: absolute; height: 16px; line-height: 16px;
  padding: 0 5px; font-size: 10px; color: #fff; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.bar.start { border-top-left-radius: 3px; border-bottom-left-radius: 3px; }
.bar.end { border-top-right-radius: 3px; border-bottom-right-radius: 3px; }
.marker { position: absolute; top: 0; right: 0; width: 0; height: 0;
  border-top: 7px solid #b45309; border-left: 7px solid transparent; }
.daycell { position: relative; }
.points { padding: 0 4px 3px; }
.point { display: block; font-size: 10px; line-height: 14px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.dot { display: inline-block; width: 6px; height: 6px; margin-right: 3px; }
.dot.milestone { transform: rotate(45deg); }
.dot.note { border-radius: 50%; }
footer { margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 8px;
  font-size: 10px; color: #6b7280; }
.notes { margin-top: 8px; }
.notes h2 { font-size: 10px; margin: 0 0 3px; color: #374151; }
.notes ul { margin: 0; padding-left: 14px; }
.notes li { margin-bottom: 1px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; }
.legend span { display: flex; align-items: center; gap: 4px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { padding: 0; }
}
`.trim();
}

/** One week row: the day numbers, the stacked bar lanes, then point elements.
 *
 * Notes render as a corner marker only, matching the screen. Their text goes
 * into the footer's Notes list instead — on paper there is no hover, so the
 * content has to live somewhere the reader can actually reach. Geometry is
 * still exactly `buildLayout`'s; only the note's presentation differs by
 * medium.
 */
function renderWeek(week: Layout["weeks"][number], locale: ScheduleLocale): string {
  const dayCells = week.days
    .map((d) => {
      const classes = ["daynum"];
      if (d.isNonWorking) classes.push("nonworking");
      if (d.isOutside) classes.push("outside");
      if (d.isMonthStart) classes.push("monthstart");
      const label = d.isMonthStart ? `${d.month}/${d.day}` : String(d.day);
      const nw = d.nonWorkingLabel
        ? `<span class="nwlabel">${esc(d.nonWorkingLabel)}</span>`
        : "";
      const marker = d.points.some((p) => p.kind === "note")
        ? '<span class="marker"></span>'
        : "";
      return `<td class="daycell">${marker}<div class="${classes.join(
        " ",
      )}">${label}</div>${nw}</td>`;
    })
    .join("");

  // Bars are absolutely positioned inside a full-width lane, in percentages of
  // the seven columns — the same geometry the screen uses, expressed without a
  // layout engine that print might disagree with.
  const lanes: string[] = [];
  for (let lane = 0; lane < week.lanes; lane++) {
    const bars = week.bars
      .filter((b) => b.lane === lane)
      .map((b) => {
        const left = (b.startCol / 7) * 100;
        const width = ((b.endCol - b.startCol + 1) / 7) * 100;
        const cls = ["bar", b.isStart ? "start" : "", b.isEnd ? "end" : ""]
          .filter(Boolean)
          .join(" ");
        const text = b.isStart ? `${esc(b.item.title)} (${b.workingDays}d)` : "";
        return `<div class="${cls}" style="left:${left}%;width:${width}%;background:${itemColor(
          b.item,
        )}">${text}</div>`;
      })
      .join("");
    lanes.push(`<div class="lane">${bars}</div>`);
  }

  const pointRow = week.days
    .map((d) => {
      const points = d.points
        .filter((p) => p.kind !== "note")
        .map(
          (p) =>
            `<span class="point"><span class="dot ${p.kind}" style="background:${itemColor(
              p,
            )}"></span>${esc(p.title)}</span>`,
        )
        .join("");
      return `<td><div class="points">${points}</div></td>`;
    })
    .join("");

  return `<tr class="week">
  <td class="gutter">${esc(monthLabel(week.gutterMonth, locale))}</td>
  <td class="dayrow">
    <table class="days"><tr>${dayCells}</tr></table>
    <div class="lanes">${lanes.join("")}</div>
    <table class="days"><tr>${pointRow}</tr></table>
  </td>
</tr>`;
}

/** The note text the grid can only show on hover, listed by date so the
 * printed copy carries it too. Empty when the schedule has no notes. */
function renderNotes(
  doc: ScheduleDocModel,
  start: string,
  end: string,
  locale: ScheduleLocale,
): string {
  const notes = doc.items
    .filter((i) => i.kind === "note" && i.start >= start && i.start <= end)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (notes.length === 0) return "";
  const items = notes
    .map((n) => `<li><strong>${n.start}</strong> ${esc(n.title)}</li>`)
    .join("");
  return `<div class="notes"><h2>${esc(strings(locale).notes)}</h2><ul>${items}</ul></div>`;
}

/** Colors actually used by this schedule, so the legend explains the plan in
 * front of the reader rather than the palette. */
function renderLegend(doc: ScheduleDocModel, locale: ScheduleLocale): string {
  const seen = new Map<string, string[]>();
  for (const item of doc.items) {
    const hex = itemColor(item);
    const list = seen.get(hex);
    if (list) {
      if (list.length < 3) list.push(item.title);
    } else {
      seen.set(hex, [item.title]);
    }
  }
  const swatches = [...seen.entries()]
    .map(
      ([hex, titles]) =>
        `<span><i class="swatch" style="background:${hex}"></i>${esc(titles.join(" / "))}</span>`,
    )
    .join("");
  return `<div class="legend">${swatches}<span><i class="swatch" style="background:#f3f4f6;border:1px solid #d1d5db"></i>${esc(
    strings(locale).nonWorkingDay,
  )}</span></div>`;
}

export interface ExportOptions {
  /** Start of the exported window (`YYYY-MM-DD`). */
  start: string;
  end: string;
  /** Date stamped in the header, `YYYY-MM-DD`. Passed in rather than read from
   * the clock so the output is reproducible in tests. */
  today: string;
  /** Display language for weekday/month labels and the header — the exported
   * file is a hand-out, so it follows the same setting as the screen rather
   * than the machine that produced it. */
  locale: ScheduleLocale;
}

/**
 * Renders a complete, self-contained HTML document for `doc` over the given
 * window. The result is written to disk by `export_schedule_html`.
 */
export function exportScheduleHtml(doc: ScheduleDocModel, options: ExportOptions): string {
  const { start, end, today, locale } = options;
  const layout = buildLayout(doc, start, end);
  const working = countWorkingDays(start, end, doc.nonWorking);
  const t = strings(locale);
  const headers = t.weekdays.map((h) => `<th>${h}</th>`).join("");

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${esc(doc.title || "schedule")}</title>
<style>${styles()}</style>
</head>
<body>
<header>
  <h1>${esc(doc.title || "schedule")}</h1>
  <div class="meta">${t.range(start, end)} &middot; ${t.workingDays(working)} &middot; ${t.exportedOn(
    today,
  )}</div>
</header>
<table class="grid">
  <thead><tr><th class="gutter"></th><th><table class="days"><tr>${headers}</tr></table></th></tr></thead>
  <tbody>
${layout.weeks.map((w) => renderWeek(w, locale)).join("\n")}
  </tbody>
</table>
<footer>${renderLegend(doc, locale)}${renderNotes(doc, start, end, locale)}</footer>
</body>
</html>
`;
}
