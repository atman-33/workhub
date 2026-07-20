#!/usr/bin/env node
// @ts-check
/**
 * Append today's progress snapshot to `backlog/progress-history.jsonl`.
 *
 * Reads every PBI's frontmatter (status, points, sprint), finds the latest
 * sprint's `scope.json` (burndown baseline), and appends one line:
 *   { date, statusCounts, totalPoints, donePoints,
 *     sprint, sprintScopePoints, sprintRemainingPoints }
 *
 * Re-running on the same day replaces that day's line (idempotent).
 *
 * Usage: node progress-snapshot.mjs <project>
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import {
  loadLocalConfig,
  listPbis,
  projectDir,
  todayStamp,
} from "../lib/team-config.mjs";

const project = process.argv[2];
if (!project) {
  console.error("usage: node progress-snapshot.mjs <project>");
  process.exit(1);
}
const local = loadLocalConfig();
if (!local) {
  console.error(
    "no .claude/team-context.json found — run the setup-team-context skill first",
  );
  process.exit(1);
}

const pDir = projectDir(local, project);
const pbis = listPbis(local, project);

/** @type {Record<string, number>} */
const statusCounts = {};
let totalPoints = 0;
let donePoints = 0;
/** @type {Map<string, { status: string, points: number }>} */
const byId = new Map();

for (const { attrs } of pbis) {
  const status = String(attrs.status || "todo");
  const points = Number(attrs.points) || 0;
  const id = String(attrs.id || "").toUpperCase();
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  totalPoints += points;
  if (status === "done") donePoints += points;
  if (id) byId.set(id, { status, points });
}

// latest sprint scope (sprints/ sorted by folder name; naming is sortable)
let sprint = "";
let sprintScopePoints = 0;
let sprintRemainingPoints = 0;
const sprintsDir = join(pDir, "sprints");
if (existsSync(sprintsDir)) {
  const sprintNames = readdirSync(sprintsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (let i = sprintNames.length - 1; i >= 0; i--) {
    const scopePath = join(sprintsDir, sprintNames[i], "scope.json");
    if (!existsSync(scopePath)) continue;
    try {
      const scope = JSON.parse(readFileSync(scopePath, "utf8"));
      sprint = sprintNames[i];
      for (const item of Array.isArray(scope.items) ? scope.items : []) {
        const id = String(item.id || "").toUpperCase();
        const points = Number(item.points) || byId.get(id)?.points || 0;
        sprintScopePoints += points;
        const status = byId.get(id)?.status || "todo";
        if (status !== "done") sprintRemainingPoints += points;
      }
    } catch {
      // malformed scope: ignore and keep looking at older sprints
    }
    break;
  }
}

const entry = {
  date: todayStamp(),
  statusCounts,
  items: pbis.length,
  totalPoints,
  donePoints,
  sprint,
  sprintScopePoints,
  sprintRemainingPoints,
};

const historyPath = join(pDir, "backlog", "progress-history.jsonl");
mkdirSync(dirname(historyPath), { recursive: true });
const lines = existsSync(historyPath)
  ? readFileSync(historyPath, "utf8").split("\n").filter(Boolean)
  : [];
const kept = lines.filter((l) => {
  try {
    return JSON.parse(l).date !== entry.date;
  } catch {
    return false;
  }
});
kept.push(JSON.stringify(entry));
writeFileSync(historyPath, `${kept.join("\n")}\n`, "utf8");

process.stdout.write(`${JSON.stringify({ historyPath, ...entry })}\n`);
