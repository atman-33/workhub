#!/usr/bin/env node
// @ts-check
/**
 * generate-progress-report.mjs — render a PBL Epic's progress &
 * completion-forecast HTML report from its already-saved Drive snapshot
 * (`save-all.mjs`'s `.pm/backlog/items/*.json`, see `scripts/lib/layout.mjs`),
 * with no network calls.
 *
 *   node generate-progress-report.mjs "<groupName>" [--fallback-velocity 6]
 *     [--sprint-days 7] [--snapshot-root <path>]
 *
 * `<snapshotRoot>` (`<epicFolder>/.pm/backlog`) auto-resolves from
 * `mondayEpics[groupName]` in `.claude/scrum-context.json` via
 * `resolveEpicFolder` (the same helper `save-all.mjs` uses) unless
 * `--snapshot-root` is passed explicitly (mainly for local testing — when
 * passed, the "repo activity" section below is derived from
 * `<snapshotRoot>/../repo` by convention, and silently omitted if that
 * doesn't resolve to real data).
 *
 * Migration guard: if the Epic folder still has a legacy `<epic>/.snapshots/`
 * and no `<epic>/.pm/` yet, this exits with a JSON error instead of reading
 * anywhere — run `scripts/setup/migrate-epic-layout.mjs` first.
 *
 * Report enhancements beyond the core status/forecast sections:
 *   - **repo activity** (reads `<epic>/.pm/repo/*.json` written by
 *     `sync-repo.mjs`; silently omitted when absent): commits/week from
 *     `commits.jsonl`, ahead/behind vs the default branch from
 *     `branch-diff.json`, active feature branches and stale WIP branches
 *     (no commit in `STALE_BRANCH_DAYS`+ days) from `branches.json`.
 *   - **priority attention**: overdue items (past due date, not Done),
 *     blocked-status ("Stuck") items, and near-done ("Working on it") items
 *     with no `link`-typed column populated (a proxy for "missing an
 *     Acceptance Criteria link" — the snapshot doesn't carry column titles,
 *     only types, so this can't distinguish an AC link from any other link
 *     column; documented as a known limitation).
 *
 * Reads every `<snapshotRoot>/items/*.json` file and keeps only those whose
 * `group` matches `<groupName>` exactly (the same file layout `save-all.mjs`
 * writes). Per item:
 *   - status: first `column_values[]` entry with `type === "status"`, its
 *     `.text` (null/empty → "未着手" / Not started). Column ids are never
 *     hardcoded — they differ per board (confirmed by comparing the
 *     Atman Marketplace and SRMS snapshots, which use different link column
 *     ids but happen to share a numbers column id by coincidence; matching
 *     is done purely by `type`).
 *   - points: first `column_values[]` entry with `type === "numbers"`, its
 *     `.text` parsed as a Number (empty/null/NaN → 0).
 *
 * "Done" detection is a literal, case-sensitive match on the status label
 * "Done" — this is what both real boards use today. A board using a
 * differently-worded completion label would need this taught to the script;
 * documented as a known limitation in the `report-pbl-progress` skill.
 *
 * Maintains `<snapshotRoot>/progress-history.json` (an array of
 * `{date, totalPoints, donePoints, statusBreakdown}`, one entry per
 * *calendar day*) — upserted so re-running the script the same day never
 * creates a duplicate entry, only updates it in place. Velocity (points per
 * `--sprint-days`-day sprint) is derived from this history:
 *   - >=3 entries: least-squares linear regression of `donePoints` against
 *     day-offset from the first entry.
 *   - exactly 2 entries: a simple two-point slope.
 *   - 1 entry, or a non-positive computed slope: falls back to
 *     `--fallback-velocity` per `--sprint-days` days, and the forecast is
 *     flagged `assumed: true` (an explicit, undisguised assumption — never
 *     presented as measured).
 *
 * Renders `<snapshotRoot>/progress-report-<YYYY-MM-DD>.html` reusing the
 * dark-theme CSS validated with the user this session
 * (`progress-report-2026-07-05.html`), but with every section (KPIs, status
 * table, per-status legend, forecast callout, discussion points, caveats)
 * generated from the computed data above rather than hardcoded.
 *
 * Prints one JSON object to stdout:
 *   {totalItems, totalPoints, byStatus, forecast, reportPath, repoActivity,
 *    attention}
 * `repoActivity` / `attention` are `null` when the underlying data isn't
 * available (no `.pm/repo/*.json`, or no priority-attention items).
 *
 * Exit codes (consistent with the rest of this plugin's scripts):
 *   0 = ok
 *   1 = unexpected/unhandled error (network-free, but fs errors etc. land
 *       here via the top-level `main().catch()`)
 *   2 = usage error / snapshot root or items dir not found / Epic not
 *       configured in `.claude/scrum-context.json`
 *   3 = zero items matched `groupName` in the snapshot
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  resolveEpicFolder,
  writeFileWithBridge,
  readFileWithBridge,
  pathExistsWithBridge,
  resolveProjectRoot,
  readStdin,
} from "../monday/monday-client.mjs";
import {
  pmRoot,
  legacySnapshotsDir,
  backlogDir,
  reportsProgressDir,
  repoStatePath,
  repoCommitsPath,
  repoBranchDiffPath,
  repoBranchesPath,
} from "../lib/layout.mjs";

const STALE_BRANCH_DAYS = 14;

/**
 * Best-effort read of `mondayBoardUrl` from `.claude/scrum-context.json`,
 * resolved via the same project-root logic `resolveEpicFolder` uses. Never
 * throws — a missing/malformed config just means no board link is rendered.
 * @returns {string | null}
 */
function readConfigBoardUrl() {
  const projectRoot = resolveProjectRoot(readStdin());
  const configPath = join(projectRoot, ".claude", "scrum-context.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config && typeof config.mondayBoardUrl === "string" && config.mondayBoardUrl.trim()) {
      return config.mondayBoardUrl.trim();
    }
  } catch {
    // ignore missing/malformed config
  }
  return null;
}

/**
 * @typedef {{ id: string, type: string, text: string | null, value: string | null }} ColumnValue
 * @typedef {{ id: string, name: string, group: string, column_values?: ColumnValue[], savedAt?: string }} ItemSnapshot
 * @typedef {{ name: string, status: string, points: number, dueDate: string | null, hasLinkColumn: boolean }} ExtractedItem
 * @typedef {{ date: string, totalPoints: number, donePoints: number, statusBreakdown: Record<string, { count: number, points: number }> }} HistoryEntry
 */

const NOT_STARTED_LABEL = "未着手";
const DONE_LABEL = "Done";

/**
 * @param {string[]} argv process.argv
 * @returns {{ groupName: string, fallbackVelocity: number, sprintDays: number, snapshotRootOverride: string | null }}
 */
function parseArgs(argv) {
  const rest = argv.slice(2);
  const positional = [];
  let fallbackVelocity = 6;
  let sprintDays = 7;
  let snapshotRootOverride = null;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--fallback-velocity") {
      fallbackVelocity = Number(rest[++i]);
    } else if (arg === "--sprint-days") {
      sprintDays = Number(rest[++i]);
    } else if (arg === "--snapshot-root") {
      snapshotRootOverride = rest[++i];
    } else {
      positional.push(arg);
    }
  }

  return {
    groupName: positional[0] || "",
    fallbackVelocity: Number.isFinite(fallbackVelocity) ? fallbackVelocity : 6,
    sprintDays: Number.isFinite(sprintDays) && sprintDays > 0 ? sprintDays : 7,
    snapshotRootOverride,
  };
}

/**
 * @param {ColumnValue[]} columnValues
 * @returns {string}
 */
function extractStatus(columnValues) {
  const col = columnValues.find((c) => c.type === "status");
  const text = col && col.text ? String(col.text).trim() : "";
  return text || NOT_STARTED_LABEL;
}

/**
 * @param {ColumnValue[]} columnValues
 * @returns {number}
 */
function extractPoints(columnValues) {
  const col = columnValues.find((c) => c.type === "numbers");
  const text = col && col.text ? String(col.text).trim() : "";
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/**
 * First `date`-typed column's value, as YYYY-MM-DD (or null). Used for
 * overdue detection in the "priority attention" section.
 * @param {ColumnValue[]} columnValues
 * @returns {string | null}
 */
function extractDueDate(columnValues) {
  const col = columnValues.find((c) => c.type === "date");
  if (!col) return null;
  const text = col.text ? String(col.text).trim() : "";
  if (text && /^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (!col.value) return null;
  try {
    const parsed = JSON.parse(col.value);
    if (parsed && typeof parsed.date === "string" && parsed.date) return parsed.date;
  } catch {
    // ignore malformed date column value
  }
  return null;
}

/**
 * Whether any `link`-typed column on this item has a value. The snapshot
 * (`save-all.mjs`'s `ITEM_SNAPSHOT_QUERY`/`GROUP_ITEMS_QUERY`) only carries
 * column `type`, not `title`, so this can't specifically distinguish an
 * "Acceptance Criteria" link column from any other link column — used as a
 * best-effort proxy for "this PBI has *a* link populated" in the priority
 * attention section (documented as a known limitation in `report-pbl-progress`).
 * @param {ColumnValue[]} columnValues
 * @returns {boolean}
 */
function hasPopulatedLinkColumn(columnValues) {
  return columnValues.some((c) => c.type === "link" && c.value);
}

// `save-all.mjs` never prunes `items/<id>.json` files for items that have
// since left the group (deleted, moved, or a stale placeholder row cleaned
// up on the board) — it only ever adds/overwrites. Leftover files from a
// *previous* snapshot batch would otherwise silently inflate this report's
// totals (confirmed against the real Atman Marketplace snapshot, which
// still carries 3 stale placeholder items — "Item 2", "Item 3",
// "○○として、○○できる" — from a 2026-07-04 run alongside the real
// 10-item 2026-07-05 run). Only the most recent snapshot batch for the
// group is used: items are kept if their `savedAt` is within
// `BATCH_WINDOW_MS` of the latest `savedAt` seen for that group; anything
// older (or missing `savedAt`) is treated as stale debris and dropped.
const BATCH_WINDOW_MS = 15 * 60 * 1000;

/**
 * @param {string} itemsDir
 * @param {string} groupName
 * @returns {ExtractedItem[]}
 */
function loadItems(itemsDir, groupName) {
  /** @type {string[]} */
  let files = [];
  try {
    files = readdirSync(itemsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  /** @type {{ parsed: ItemSnapshot, savedAtMs: number }[]} */
  const matched = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = /** @type {ItemSnapshot} */ (
        JSON.parse(readFileSync(join(itemsDir, file), "utf8"))
      );
    } catch {
      continue;
    }
    if (!parsed || parsed.group !== groupName) continue;
    const savedAtMs = parsed.savedAt ? Date.parse(parsed.savedAt) : NaN;
    matched.push({ parsed, savedAtMs });
  }

  const maxSavedAtMs = matched.reduce(
    (max, m) => (Number.isFinite(m.savedAtMs) && m.savedAtMs > max ? m.savedAtMs : max),
    -Infinity
  );

  /** @type {ExtractedItem[]} */
  const items = [];
  for (const { parsed, savedAtMs } of matched) {
    if (!Number.isFinite(savedAtMs) || maxSavedAtMs - savedAtMs > BATCH_WINDOW_MS) continue;
    const columnValues = parsed.column_values || [];
    items.push({
      name: parsed.name || parsed.id,
      status: extractStatus(columnValues),
      points: extractPoints(columnValues),
      dueDate: extractDueDate(columnValues),
      hasLinkColumn: hasPopulatedLinkColumn(columnValues),
    });
  }
  return items;
}

/**
 * @typedef {{ overdue: Array<{ name: string, dueDate: string }>, blocked: Array<{ name: string }>, nearDoneMissingLink: Array<{ name: string }> }} AttentionSummary
 */

/**
 * Priority-attention items: overdue (past due date, not Done), blocked
 * ("Stuck" status), and near-done ("Working on it") with no link column
 * populated (see `hasPopulatedLinkColumn`'s doc comment for the caveat).
 * @param {ExtractedItem[]} items
 * @param {string} todayDate YYYY-MM-DD
 * @returns {AttentionSummary | null}
 */
function computeAttention(items, todayDate) {
  const overdue = items
    .filter((i) => i.dueDate && i.dueDate < todayDate && i.status !== DONE_LABEL)
    .map((i) => ({ name: i.name, dueDate: /** @type {string} */ (i.dueDate) }));
  const blocked = items
    .filter((i) => i.status === "Stuck")
    .map((i) => ({ name: i.name }));
  const nearDoneMissingLink = items
    .filter((i) => i.status === "Working on it" && !i.hasLinkColumn)
    .map((i) => ({ name: i.name }));

  if (overdue.length === 0 && blocked.length === 0 && nearDoneMissingLink.length === 0) {
    return null;
  }
  return { overdue, blocked, nearDoneMissingLink };
}

/**
 * @param {ExtractedItem[]} items
 * @returns {{ totalItems: number, totalPoints: number, donePoints: number, byStatus: Record<string, { count: number, points: number }> }}
 */
function aggregate(items) {
  /** @type {Record<string, { count: number, points: number }>} */
  const byStatus = {};
  let totalPoints = 0;
  let donePoints = 0;

  for (const item of items) {
    if (!byStatus[item.status]) byStatus[item.status] = { count: 0, points: 0 };
    byStatus[item.status].count += 1;
    byStatus[item.status].points += item.points;
    totalPoints += item.points;
    if (item.status === DONE_LABEL) donePoints += item.points;
  }

  return { totalItems: items.length, totalPoints, donePoints, byStatus };
}

/**
 * @returns {string} today's date as YYYY-MM-DD (local time)
 */
function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {string} historyPath
 * @returns {HistoryEntry[]}
 */
function readHistory(historyPath) {
  if (!existsSync(historyPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(historyPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Upsert today's entry into history (in place if a same-date entry already
 * exists, else appended), keeping the array sorted by date ascending.
 * @param {HistoryEntry[]} history
 * @param {HistoryEntry} entry
 * @returns {HistoryEntry[]}
 */
function upsertHistory(history, entry) {
  const idx = history.findIndex((h) => h.date === entry.date);
  const next = idx >= 0 ? [...history] : [...history, entry];
  if (idx >= 0) next[idx] = entry;
  next.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return next;
}

/**
 * @param {string} isoDate YYYY-MM-DD
 * @returns {number} days since epoch (UTC midnight), for slope arithmetic only
 */
function dayNumber(isoDate) {
  return Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / 86400000);
}

/**
 * Compute points/week velocity from history using regression (>=3 points),
 * a two-point slope (exactly 2 points), or null when not computable
 * (1 point, or the computed slope is <= 0) — callers fall back to the
 * `--fallback-velocity` in the null case.
 * @param {HistoryEntry[]} history
 * @param {number} sprintDays
 * @returns {number | null}
 */
function computeMeasuredVelocityPerWeek(history, sprintDays) {
  if (history.length < 2) return null;

  const points = history.map((h) => ({
    x: dayNumber(h.date),
    y: h.donePoints,
  }));

  let slopePerDay;
  if (points.length === 2) {
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    if (dx === 0) return null;
    slopePerDay = dy / dx;
  } else {
    // Least-squares linear regression: y = a + b*x
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const meanX = sumX / n;
    const meanY = sumY / n;
    const num = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
    const den = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
    if (den === 0) return null;
    slopePerDay = num / den;
  }

  if (!Number.isFinite(slopePerDay) || slopePerDay <= 0) return null;
  return slopePerDay * sprintDays;
}

/**
 * @param {{ totalPoints: number, donePoints: number, history: HistoryEntry[], fallbackVelocity: number, sprintDays: number }} args
 * @returns {{ assumed: boolean, velocityPerWeek: number, remainingPoints: number, forecastDate: string | null, alreadyComplete: boolean, note: string }}
 */
function computeForecast({ totalPoints, donePoints, history, fallbackVelocity, sprintDays }) {
  const remainingPoints = Math.max(0, totalPoints - donePoints);

  if (remainingPoints === 0) {
    return {
      assumed: false,
      velocityPerWeek: 0,
      remainingPoints: 0,
      forecastDate: null,
      alreadyComplete: true,
      note: "All points already complete — no forecast needed.",
    };
  }

  const measured = computeMeasuredVelocityPerWeek(history, sprintDays);
  const assumed = measured === null;
  const velocityPerWeek = assumed ? fallbackVelocity : measured;

  if (!Number.isFinite(velocityPerWeek) || velocityPerWeek <= 0) {
    return {
      assumed: true,
      velocityPerWeek: 0,
      remainingPoints,
      forecastDate: null,
      alreadyComplete: false,
      note: "No plausible forecast: velocity is zero or negative even after falling back to --fallback-velocity.",
    };
  }

  const weeksRemaining = remainingPoints / velocityPerWeek;
  const daysRemaining = Math.ceil(weeksRemaining * 7);
  const forecast = new Date();
  forecast.setDate(forecast.getDate() + daysRemaining);
  const forecastDate = `${forecast.getFullYear()}-${String(
    forecast.getMonth() + 1
  ).padStart(2, "0")}-${String(forecast.getDate()).padStart(2, "0")}`;

  return {
    assumed,
    velocityPerWeek,
    remainingPoints,
    forecastDate,
    alreadyComplete: false,
    note: assumed
      ? `Assumed velocity (not measured): ${fallbackVelocity}pt / ${sprintDays} days.`
      : `Measured velocity from ${history.length} snapshot day(s): ${velocityPerWeek.toFixed(1)}pt / ${sprintDays} days.`,
  };
}

const STATUS_BADGE_CLASS = {
  Done: "done",
  "Working on it": "working",
  Stuck: "stuck",
  [NOT_STARTED_LABEL]: "notstarted",
};

/**
 * @param {string} status
 * @returns {string}
 */
function badgeClass(status) {
  return STATUS_BADGE_CLASS[status] || "notstarted";
}

/**
 * Stable status ordering for the table/legend: the four well-known labels in
 * a fixed order, then any other label seen (alphabetically) — keeps output
 * deterministic across boards with custom status labels.
 * @param {string[]} statuses
 * @returns {string[]}
 */
function orderStatuses(statuses) {
  const known = ["Done", "Working on it", "Stuck", NOT_STARTED_LABEL];
  const rest = statuses.filter((s) => !known.includes(s)).sort();
  return [...known.filter((s) => statuses.includes(s)), ...rest];
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const REPORT_CSS = `:root {
    --bg: #0f1420;
    --panel: #161d2e;
    --panel-2: #1c2436;
    --border: #2a3450;
    --text: #e8ecf5;
    --muted: #9aa5bd;
    --accent: #6c8bff;
    --done: #34d399;
    --working: #60a5fa;
    --stuck: #f87171;
    --notstarted: #6b7686;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: "Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
    line-height: 1.6;
    padding: 32px 16px 64px;
  }
  .wrap { max-width: 1040px; margin: 0 auto; }
  header.report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 12px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
    margin-bottom: 28px;
  }
  header.report-header h1 { margin: 0 0 6px; font-size: 22px; }
  header.report-header .sub { color: var(--muted); font-size: 13px; }
  header.report-header a {
    color: var(--accent); text-decoration: none; font-size: 13px;
  }
  header.report-header a:hover { text-decoration: underline; }
  section { margin-bottom: 36px; }
  h2 {
    font-size: 15px;
    letter-spacing: .04em;
    color: var(--muted);
    text-transform: uppercase;
    margin: 0 0 14px;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  }
  .kpi-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
  }
  .kpi-card .label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .kpi-card .value { font-size: 24px; font-weight: 600; }
  .kpi-card .sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .kpi-card.accent .value { color: var(--accent); }
  .kpi-card.stuck .value { color: var(--stuck); }
  table.status-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  table.status-table th, table.status-table td {
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  table.status-table th {
    background: var(--panel-2);
    color: var(--muted);
    font-weight: 500;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .03em;
  }
  table.status-table tr:last-child td { border-bottom: none; }
  table.status-table td.pt { text-align: right; font-variant-numeric: tabular-nums; }
  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: #0b0f18;
  }
  .badge.done { background: var(--done); }
  .badge.working { background: var(--working); }
  .badge.stuck { background: var(--stuck); }
  .badge.notstarted { background: var(--notstarted); color: #e8ecf5; }
  .chart-row {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 28px;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
  }
  @media (max-width: 640px) {
    .chart-row { grid-template-columns: 1fr; }
  }
  .donut-wrap { display: flex; align-items: center; justify-content: center; }
  .donut-center { font-size: 13px; fill: var(--text); }
  .legend { list-style: none; margin: 0; padding: 0; }
  .legend li {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; margin-bottom: 8px;
  }
  .legend .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .legend .name { flex: 1; }
  .legend .num { color: var(--muted); font-variant-numeric: tabular-nums; }
  .stack-bar {
    display: flex;
    height: 28px;
    border-radius: 6px;
    overflow: hidden;
    margin-top: 16px;
    border: 1px solid var(--border);
  }
  .stack-bar span { display: block; }
  .forecast-callout {
    background: linear-gradient(135deg, #1c2436, #202a44);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: 10px;
    padding: 20px 22px;
  }
  .forecast-callout .headline {
    font-size: 20px; font-weight: 600; margin-bottom: 8px;
  }
  .forecast-callout .headline .date { color: var(--accent); }
  .forecast-callout .assumptions {
    font-size: 13px; color: var(--muted); margin-top: 10px;
    border-top: 1px dashed var(--border); padding-top: 10px;
  }
  .forecast-callout .assumptions code {
    background: #0b0f18; padding: 1px 6px; border-radius: 4px;
  }
  ul.discussion {
    list-style: none; margin: 0; padding: 0;
    display: grid; gap: 10px;
  }
  ul.discussion li {
    background: var(--panel);
    border: 1px solid var(--border);
    border-left: 4px solid var(--muted);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 14px;
  }
  ul.discussion li.stuck { border-left-color: var(--stuck); }
  ul.discussion li.big { border-left-color: var(--working); }
  ul.discussion li .tag {
    font-size: 11px; color: var(--muted); text-transform: uppercase;
    letter-spacing: .03em; display: block; margin-bottom: 3px;
  }
  footer.caveats {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
    font-size: 13px;
    color: var(--muted);
  }
  footer.caveats h2 { color: var(--muted); }
  footer.caveats ul { margin: 0; padding-left: 18px; }
  footer.caveats li { margin-bottom: 6px; }`;

const STATUS_COLOR_VAR = {
  Done: "--done",
  "Working on it": "--working",
  Stuck: "--stuck",
  [NOT_STARTED_LABEL]: "--notstarted",
};

/**
 * @param {string} status
 * @returns {string}
 */
function colorVar(status) {
  return STATUS_COLOR_VAR[status] || "--notstarted";
}

/**
 * @typedef {{
 *   commitsPerWeek: number,
 *   epicBranch: string,
 *   defaultBranch: string,
 *   sameBranch: boolean,
 *   aheadBy: number | null,
 *   behindBy: number | null,
 *   activeFeatureBranches: Array<{ name: string, lastCommitDate: string }>,
 *   staleWipBranches: Array<{ name: string, lastCommitDate: string }>,
 *   mergedBranchCount: number,
 *   lastSyncAt: string | null,
 * }} RepoActivitySummary
 */

/**
 * Read `<epicFolder>/.pm/repo/*.json` (written by `sync-repo.mjs`) and
 * derive the "repo activity" section's data. Returns `null` when
 * `repo-state.json` is missing/unreadable — the section is then silently
 * omitted from the report, since not every Epic has a repo configured.
 * @param {string} epicFolder
 * @returns {RepoActivitySummary | null}
 */
function computeRepoActivity(epicFolder) {
  const stateRaw = readFileWithBridge(repoStatePath(epicFolder));
  if (!stateRaw) return null;

  /** @type {{ epicBranch?: string, defaultBranch?: string, lastSyncAt?: string }} */
  let state;
  try {
    state = JSON.parse(stateRaw);
  } catch {
    return null;
  }
  if (!state || !state.epicBranch) return null;

  const commitsRaw = readFileWithBridge(repoCommitsPath(epicFolder)) || "";
  const nowMs = Date.now();
  const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  let commitsPerWeek = 0;
  for (const line of commitsRaw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const commit = JSON.parse(line);
      if (commit && commit.date && Date.parse(commit.date) >= weekAgoMs) commitsPerWeek += 1;
    } catch {
      // ignore malformed line
    }
  }

  const diffRaw = readFileWithBridge(repoBranchDiffPath(epicFolder));
  let sameBranch = false;
  let aheadBy = null;
  let behindBy = null;
  if (diffRaw) {
    try {
      const diff = JSON.parse(diffRaw);
      sameBranch = Boolean(diff.sameBranch);
      aheadBy = typeof diff.aheadBy === "number" ? diff.aheadBy : null;
      behindBy = typeof diff.behindBy === "number" ? diff.behindBy : null;
    } catch {
      // ignore malformed branch-diff.json
    }
  }

  const branchesRaw = readFileWithBridge(repoBranchesPath(epicFolder));
  /** @type {Array<{ name: string, lastCommitDate: string }>} */
  const activeFeatureBranches = [];
  /** @type {Array<{ name: string, lastCommitDate: string }>} */
  const staleWipBranches = [];
  let mergedBranchCount = 0;
  if (branchesRaw) {
    try {
      const branches = JSON.parse(branchesRaw);
      const staleCutoffMs = nowMs - STALE_BRANCH_DAYS * 24 * 60 * 60 * 1000;
      for (const branch of Array.isArray(branches) ? branches : []) {
        if (!branch || !branch.name) continue;
        // Merged branches are finished work whose remote ref just hasn't been
        // deleted yet — neither active WIP nor stale WIP, so keep them out of
        // both lists (only a count) or every long-lived repo reports all its
        // old merged branches as "active".
        if (branch.mergedIntoEpic) {
          mergedBranchCount += 1;
          continue;
        }
        const lastCommitMs = branch.lastCommitDate ? Date.parse(branch.lastCommitDate) : NaN;
        const entry = { name: branch.name, lastCommitDate: branch.lastCommitDate || "" };
        if (Number.isFinite(lastCommitMs) && lastCommitMs < staleCutoffMs) {
          staleWipBranches.push(entry);
        } else {
          activeFeatureBranches.push(entry);
        }
      }
    } catch {
      // ignore malformed branches.json
    }
  }

  return {
    commitsPerWeek,
    epicBranch: state.epicBranch,
    defaultBranch: state.defaultBranch || "",
    sameBranch,
    aheadBy,
    behindBy,
    activeFeatureBranches,
    staleWipBranches,
    mergedBranchCount,
    lastSyncAt: state.lastSyncAt || null,
  };
}

/**
 * Render an SVG donut (stroke-dasharray per-segment) for the status
 * breakdown by points, plus a matching stacked progress bar — the
 * "donut chart via stroke-dasharray" + "stacked progress bar" pair the plan
 * describes. The validated reference HTML shipped a text label and an empty
 * `.stack-bar` div instead of an actual chart; rendering the real SVG/bar
 * here is a small step up in faithfulness to the described design and is
 * still driven entirely by computed data.
 * @param {string[]} orderedStatuses
 * @param {Record<string, { count: number, points: number }>} byStatus
 * @param {number} totalPoints
 * @returns {{ donutSvg: string, stackBarHtml: string, legendHtml: string }}
 */
function renderDonutAndBar(orderedStatuses, byStatus, totalPoints) {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = [];
  const barSegments = [];
  const legendItems = [];

  for (const status of orderedStatuses) {
    const { count, points } = byStatus[status];
    const pct = totalPoints > 0 ? (points / totalPoints) * 100 : 0;
    const dash = (pct / 100) * circumference;
    const cssVar = colorVar(status);

    segments.push(
      `<circle r="${radius}" cx="90" cy="90" fill="transparent" stroke="var(${cssVar})" ` +
        `stroke-width="24" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" ` +
        `stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 90 90)" />`
    );
    offset += dash;

    if (pct > 0) {
      barSegments.push(
        `<span style="width:${pct.toFixed(2)}%;background:var(${cssVar})" title="${escapeHtml(status)} ${pct.toFixed(0)}%"></span>`
      );
    }

    legendItems.push(
      `<li><span class="dot" style="background:var(${cssVar})"></span>` +
        `<span class="name">${escapeHtml(status)}</span> ` +
        `<span class="num">${points}pt（${pct.toFixed(0)}%）・${count}件</span></li>`
    );
  }

  const donePct = totalPoints > 0 ? Math.round(((byStatus[DONE_LABEL]?.points || 0) / totalPoints) * 100) : 0;

  const donutSvg =
    `<div class="donut-wrap"><svg width="180" height="180" viewBox="0 0 180 180">` +
    segments.join("") +
    `<circle r="${radius - 24}" cx="90" cy="90" fill="var(--panel)" />` +
    `<text x="90" y="90" text-anchor="middle" dominant-baseline="middle" class="donut-center">${donePct}%完了</text>` +
    `</svg></div>`;

  return {
    donutSvg,
    stackBarHtml: `<div class="stack-bar">${barSegments.join("")}</div>`,
    legendHtml: `<ul class="legend">${legendItems.join("")}</ul>`,
  };
}

/**
 * @param {{
 *   groupName: string,
 *   items: ExtractedItem[],
 *   byStatus: Record<string, { count: number, points: number }>,
 *   totalItems: number,
 *   totalPoints: number,
 *   donePoints: number,
 *   forecast: ReturnType<typeof computeForecast>,
 *   sprintDays: number,
 *   date: string,
 *   boardUrl: string | null,
 *   repoActivity: RepoActivitySummary | null,
 *   attention: AttentionSummary | null,
 * }} data
 * @returns {string}
 */
function renderHtml(data) {
  const { groupName, items, byStatus, totalItems, totalPoints, donePoints, forecast, sprintDays, date, boardUrl, repoActivity, attention } = data;
  const orderedStatuses = orderStatuses(Object.keys(byStatus));
  const { donutSvg, stackBarHtml, legendHtml } = renderDonutAndBar(orderedStatuses, byStatus, totalPoints);

  const doneCount = byStatus[DONE_LABEL]?.count || 0;
  const donePct = totalItems > 0 ? Math.round((doneCount / totalItems) * 100) : 0;
  const donePtPct = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;

  const kpiCardsExtra = orderedStatuses
    .filter((s) => s !== DONE_LABEL)
    .map((s) => {
      const { count, points } = byStatus[s];
      const cls = s === "Stuck" ? " stuck" : "";
      return `<div class="kpi-card${cls}"><div class="label">${escapeHtml(s)}</div><div class="value">${count}件</div><div class="sub">${points}pt</div></div>`;
    })
    .join("\n      ");

  const tableRows = items
    .slice()
    .sort((a, b) => orderedStatuses.indexOf(a.status) - orderedStatuses.indexOf(b.status))
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.name)}</td><td><span class="badge ${badgeClass(item.status)}">${escapeHtml(item.status)}</span></td><td class="pt">${item.points}</td></tr>`
    )
    .join("\n        ");

  const stuckItems = items.filter((i) => i.status === "Stuck");
  const notStartedBig = items
    .filter((i) => i.status === NOT_STARTED_LABEL)
    .sort((a, b) => b.points - a.points);
  const workingBig = items
    .filter((i) => i.status === "Working on it")
    .sort((a, b) => b.points - a.points);

  /** @type {string[]} */
  const discussionItems = [];
  for (const item of stuckItems) {
    discussionItems.push(
      `<li class="stuck"><span class="tag">Stuck</span><strong>${escapeHtml(item.name)}</strong>（${item.points}pt）— 何がブロッカーになっているか確認し、解消策を検討したい。</li>`
    );
  }
  if (notStartedBig.length > 0) {
    const top = notStartedBig[0];
    discussionItems.push(
      `<li class="big"><span class="tag">未着手・大型（${top.points}pt）</span><strong>${escapeHtml(top.name)}</strong>（${top.points}pt）— 未着手の中で最大のPBI。優先着手の候補。</li>`
    );
  }
  if (workingBig.length > 0) {
    const top = workingBig[0];
    discussionItems.push(
      `<li class="big"><span class="tag">進行中・大型（${top.points}pt）</span><strong>${escapeHtml(top.name)}</strong>（${top.points}pt）— 進行中の中で最大のPBI。完了見込みを確認したい。</li>`
    );
  }
  if (notStartedBig.length > 1) {
    const restNames = notStartedBig
      .slice(1)
      .map((i) => `<strong>${escapeHtml(i.name)}</strong>（${i.points}pt）`)
      .join(" ／ ");
    discussionItems.push(
      `<li><span class="tag">未着手</span>${restNames} — 着手順序を検討したい。</li>`
    );
  }
  if (discussionItems.length === 0) {
    discussionItems.push(`<li>特筆すべき懸念事項はありません。</li>`);
  }

  const forecastHeadline = forecast.alreadyComplete
    ? `<div class="headline">全ポイント完了済み 🎉</div>`
    : forecast.forecastDate
      ? `<div class="headline">概算完了予定: <span class="date">${forecast.forecastDate}</span>（残り${forecast.remainingPoints}pt）</div>`
      : `<div class="headline">完了予測を算出できません</div>`;

  const assumptionText = forecast.alreadyComplete
    ? "全ポイントが完了しているため、追加の完了予測は不要です。"
    : forecast.assumed
      ? `現在の消化ペースを実測できるデータが十分に無いため、以下の仮定に基づく概算です。前提: <code>1スプリント = ${sprintDays}日</code> ／ 想定ベロシティ <code>約${forecast.velocityPerWeek || "?"}pt / ${sprintDays}日</code>（参考値・実測ではありません）。今後も定期的にスナップショットを取得し実績が蓄積されれば、この仮定値を実測ベロシティに置き換えて精度を上げる予定です。`
      : `過去のスナップショット履歴から実測したベロシティに基づく概算です。実測ベロシティ: <code>約${forecast.velocityPerWeek.toFixed(1)}pt / ${sprintDays}日</code>。`;

  const caveats = [
    "monday ボードには締切日・スプリント・担当者の列が存在せず、ステータスとポイントのみが実質的に使えるデータです。",
    forecast.assumed
      ? `完了予測は実測ベロシティではなく「1スプリント=${sprintDays}日、約${forecast.velocityPerWeek || "?"}pt/${sprintDays}日」という参考仮定値に基づく概算です。`
      : `完了予測は過去のスナップショット履歴から算出した実測ベロシティに基づく概算です。`,
    "ポイントはチームの手動見積もりであり、今後のスコープ追加（新規PBIの追加など）は考慮していません。",
    `本レポートは ${date} 時点の単一スナップショットに基づきます。`,
  ];

  const boardLink = boardUrl
    ? `<a href="${escapeHtml(boardUrl)}" target="_blank" rel="noopener">monday.com ボードを開く ↗</a>`
    : "";

  const repoActivitySection = repoActivity
    ? `<section>
    <h2>リポジトリアクティビティ</h2>
    <div class="kpi-grid">
      <div class="kpi-card accent">
        <div class="label">週間コミット数</div>
        <div class="value">${repoActivity.commitsPerWeek}</div>
        <div class="sub">直近7日間</div>
      </div>
      <div class="kpi-card">
        <div class="label">Epic ブランチ</div>
        <div class="value" style="font-size:15px;">${escapeHtml(repoActivity.epicBranch)}</div>
        <div class="sub">${
          repoActivity.sameBranch
            ? "default branch と同一"
            : `default (${escapeHtml(repoActivity.defaultBranch)}) 比: +${repoActivity.aheadBy ?? "?"} / -${repoActivity.behindBy ?? "?"}`
        }</div>
      </div>
      <div class="kpi-card">
        <div class="label">アクティブな feature ブランチ</div>
        <div class="value">${repoActivity.activeFeatureBranches.length}</div>
      </div>
      <div class="kpi-card${repoActivity.staleWipBranches.length > 0 ? " stuck" : ""}">
        <div class="label">停滞 WIP ブランチ（${STALE_BRANCH_DAYS}日+未更新）</div>
        <div class="value">${repoActivity.staleWipBranches.length}</div>
      </div>
    </div>
    ${
      repoActivity.staleWipBranches.length > 0
        ? `<ul class="discussion" style="margin-top:12px;">
      ${repoActivity.staleWipBranches
        .map(
          (b) =>
            `<li class="stuck"><span class="tag">停滞 WIP</span><strong>${escapeHtml(b.name)}</strong> — 最終コミット: ${escapeHtml(b.lastCommitDate || "不明")}</li>`
        )
        .join("\n      ")}
    </ul>`
        : ""
    }
  </section>`
    : "";

  const attentionSection = attention
    ? `<section>
    <h2>優先対応事項</h2>
    <ul class="discussion">
      ${[
        ...attention.overdue.map(
          (i) =>
            `<li class="stuck"><span class="tag">期限超過</span><strong>${escapeHtml(i.name)}</strong> — 期限: ${escapeHtml(i.dueDate)}</li>`
        ),
        ...attention.blocked.map(
          (i) => `<li class="stuck"><span class="tag">ブロック中</span><strong>${escapeHtml(i.name)}</strong></li>`
        ),
        ...attention.nearDoneMissingLink.map(
          (i) =>
            `<li class="big"><span class="tag">完了間近・リンク未設定</span><strong>${escapeHtml(i.name)}</strong> — Acceptance Criteria 等のリンク列が未設定です。</li>`
        ),
      ].join("\n      ")}
    </ul>
  </section>`
    : "";

  return `<style>${REPORT_CSS}</style>
<div class="wrap">
  <header class="report-header">
    <div>
      <h1>${escapeHtml(groupName)} — PBL 進捗レポート</h1>
      <div class="sub">Epic: ${escapeHtml(groupName)} ／ スナップショット日: ${date}</div>
    </div>
    ${boardLink}
  </header>
  <section>
    <h2>サマリー</h2>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="label">総PBI件数</div>
        <div class="value">${totalItems}</div>
        <div class="sub">総${totalPoints}pt</div>
      </div>
      <div class="kpi-card accent">
        <div class="label">完了率（件数）</div>
        <div class="value">${donePct}%</div>
        <div class="sub">${doneCount} / ${totalItems} 件</div>
      </div>
      <div class="kpi-card accent">
        <div class="label">完了率（pt）</div>
        <div class="value">${donePtPct}%</div>
        <div class="sub">${donePoints} / ${totalPoints} pt</div>
      </div>
      ${kpiCardsExtra}
    </div>
  </section>
  <section>
    <h2>ステータス内訳</h2>
    <table class="status-table">
      <thead>
        <tr>
          <th>PBI</th>
          <th>ステータス</th>
          <th style="text-align: right;">Pt</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </section>
  <section>
    <h2>ポイント内訳（ステータス別）</h2>
    <div class="chart-row">
      ${donutSvg}
      <div>
        ${legendHtml}
        ${stackBarHtml}
      </div>
    </div>
  </section>
  <section>
    <h2>完了予測（参考値）</h2>
    <div class="forecast-callout">
      ${forecastHeadline}
      <div class="assumptions">${assumptionText}</div>
    </div>
  </section>
  <section>
    <h2>検討材料</h2>
    <ul class="discussion">
      ${discussionItems.join("\n      ")}
    </ul>
  </section>
  ${repoActivitySection}
  ${attentionSection}
  <footer class="caveats">
    <h2>注意点</h2>
    <ul>
      ${caveats.map((c) => `<li>${c}</li>`).join("\n      ")}
    </ul>
  </footer>
</div>
`;
}

async function main() {
  const { groupName, fallbackVelocity, sprintDays, snapshotRootOverride } = parseArgs(process.argv);

  if (!groupName) {
    process.stderr.write(
      'report: usage: generate-progress-report.mjs "<groupName>" [--fallback-velocity 6] [--sprint-days 7] [--snapshot-root <path>]\n' +
        "snapshot-root falls back to `mondayEpics[groupName]` + `.pm/backlog` " +
        "from `.claude/scrum-context.json` when not passed explicitly.\n"
    );
    process.exit(2);
    return;
  }

  let backlogRoot = snapshotRootOverride;
  /** @type {string | null} */
  let epicFolder = null;
  /** @type {string} */
  let reportsDirPath;

  if (!backlogRoot) {
    epicFolder = await resolveEpicFolder(groupName);
    if (!epicFolder) {
      process.stderr.write(
        `report: no --snapshot-root given and no mondayEpics["${groupName}"] ` +
          "configured in `.claude/scrum-context.json`.\n"
      );
      process.exit(2);
      return;
    }

    // Migration guard: a legacy `.snapshots` folder with no `.pm` yet means
    // this Epic hasn't been migrated to the current layout.
    if (
      pathExistsWithBridge(legacySnapshotsDir(epicFolder)) &&
      !pathExistsWithBridge(pmRoot(epicFolder))
    ) {
      process.stdout.write(
        JSON.stringify({
          error: "legacy-layout-not-migrated",
          message:
            `report: "${epicFolder}" still has a legacy .snapshots/ folder and no .pm/ ` +
            "folder yet. Run `node scripts/setup/migrate-epic-layout.mjs " +
            `"${groupName}"\` first, then re-run generate-progress-report.mjs.`,
          epicFolder,
        }) + "\n"
      );
      process.exit(1);
      return;
    }

    backlogRoot = backlogDir(epicFolder);
    reportsDirPath = reportsProgressDir(epicFolder);
  } else {
    // Testing/override convenience: `--snapshot-root` points directly at the
    // backlog root (items/ + progress-history.json). Best-effort derive the
    // epic folder from the `<epic>/.pm/backlog` convention so the optional
    // repo-activity lookup still works when the override follows it;
    // `computeRepoActivity` silently returns null otherwise.
    epicFolder = dirname(dirname(backlogRoot));
    reportsDirPath = join(dirname(backlogRoot), "reports", "progress");
  }

  const itemsDir = join(backlogRoot, "items");
  if (!existsSync(itemsDir)) {
    process.stderr.write(
      `report: items directory not found: "${itemsDir}". Run snapshot-pbl-to-drive first.\n`
    );
    process.exit(2);
    return;
  }

  const items = loadItems(itemsDir, groupName);
  if (items.length === 0) {
    process.stderr.write(
      `report: no items found for group "${groupName}" under "${itemsDir}".\n`
    );
    process.exit(3);
    return;
  }

  const { totalItems, totalPoints, donePoints, byStatus } = aggregate(items);

  const date = todayIso();
  const historyPath = join(backlogRoot, "progress-history.json");
  const history = readHistory(historyPath);
  const updatedHistory = upsertHistory(history, {
    date,
    totalPoints,
    donePoints,
    statusBreakdown: byStatus,
  });
  writeFileWithBridge(historyPath, JSON.stringify(updatedHistory, null, 2) + "\n");

  const forecast = computeForecast({
    totalPoints,
    donePoints,
    history: updatedHistory,
    fallbackVelocity,
    sprintDays,
  });

  const boardUrl = readConfigBoardUrl();
  const repoActivity = computeRepoActivity(epicFolder);
  const attention = computeAttention(items, date);

  const reportPath = join(reportsDirPath, `progress-report-${date}.html`);
  const html = renderHtml({
    groupName,
    items,
    byStatus,
    totalItems,
    totalPoints,
    donePoints,
    forecast,
    sprintDays,
    date,
    boardUrl,
    repoActivity,
    attention,
  });
  writeFileWithBridge(reportPath, html);

  process.stdout.write(
    JSON.stringify({
      totalItems,
      totalPoints,
      byStatus,
      forecast,
      reportPath,
      repoActivity,
      attention,
    }) + "\n"
  );
}

main().catch((err) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exit(1);
});
