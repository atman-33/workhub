#!/usr/bin/env node
// @ts-check
/**
 * migrate-epic-layout.mjs — one-shot migration of an Epic's machine-managed
 * data from the legacy `.snapshots/` layout to the current `.pm/` layout
 * (see `scripts/lib/layout.mjs`):
 *
 *   <epic>/.snapshots/items/*.json    -> <epic>/.pm/backlog/items/*.json
 *   <epic>/.snapshots/docs/*.md       -> <epic>/.pm/backlog/docs/*.md
 *   <epic>/.snapshots/updates/*.json  -> <epic>/.pm/backlog/updates/*.json
 *   <epic>/.snapshots/progress-history.json
 *                                      -> <epic>/.pm/backlog/progress-history.json
 *   <epic>/.snapshots/progress-report-*.html
 *                                      -> <epic>/.pm/reports/progress/
 *
 *   node migrate-epic-layout.mjs "<groupName>"
 *   node migrate-epic-layout.mjs "<explicit epic folder path>"
 *
 * The single argument is tried first as a `mondayEpics` group name (resolved
 * via `resolveEpicFolder`); if that yields nothing, it is treated as a
 * literal epic folder path.
 *
 * Idempotent: entries that no longer exist under `.snapshots` (already
 * moved, or never present) are reported as `skipped`, not errors, so running
 * this twice in a row is a no-op the second time. The now-empty `.snapshots`
 * folder is removed once every entry it contained has been migrated (or was
 * absent to begin with).
 *
 * Prints one JSON summary object to stdout: `{epicFolder, moved, skipped,
 * errors, legacyDirRemoved}`. Exit codes: 0 = ok (including "nothing to
 * migrate"), 1 = unexpected error, 2 = usage error / epic folder not
 * resolvable.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  isWindowsDrivePath,
  listDirEntriesViaPowershell,
  moveViaBridge,
  mkdirViaBridge,
  deleteViaBridge,
} from "../drive/drive-bridge.mjs";
import {
  resolveEpicFolder,
  pathExistsWithBridge,
  printJson,
} from "../monday/monday-client.mjs";
import {
  legacySnapshotsDir,
  backlogItemsDir,
  backlogDocsDir,
  backlogUpdatesDir,
  backlogProgressHistoryPath,
  reportsProgressDir,
} from "../lib/layout.mjs";

/**
 * List entry names directly under `dirPath`, trying direct Node `readdirSync`
 * first and falling back to the powershell bridge for Windows drive paths
 * unreachable directly from WSL. Returns [] when `dirPath` doesn't exist.
 * @param {string} dirPath
 * @returns {string[]}
 */
function listEntries(dirPath) {
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(dirPath);
  if (onWindows || !looksWindows) {
    try {
      return readdirSync(dirPath);
    } catch {
      return [];
    }
  }
  return listDirEntriesViaPowershell(dirPath);
}

/**
 * Move one file/directory `from` -> `to` if `from` exists, recording the
 * result in `moved`/`skipped`/`errors`. No-op (skipped) when `from` doesn't
 * exist — that's what makes repeated runs idempotent.
 * @param {string} label
 * @param {string} from
 * @param {string} to
 * @param {{ moved: string[], skipped: string[], errors: string[] }} summary
 */
function migrateEntry(label, from, to, summary) {
  if (!pathExistsWithBridge(from)) {
    summary.skipped.push(label);
    return;
  }
  // `moveViaBridge`'s direct (non-bridge) path is a bare `renameSync`, which
  // fails if the destination's parent directory doesn't exist yet — unlike
  // its powershell-bridge path, which creates it. Always ensure the parent
  // exists first so both paths behave the same.
  mkdirViaBridge(dirname(to));
  const result = moveViaBridge(from, to);
  if (result.ok) {
    summary.moved.push(label);
  } else {
    summary.errors.push(`${label}: move "${from}" -> "${to}" failed`);
  }
}

/**
 * @param {string} epicFolder
 */
function migrateEpic(epicFolder) {
  /** @type {{ moved: string[], skipped: string[], errors: string[] }} */
  const summary = { moved: [], skipped: [], errors: [] };

  const legacyDir = legacySnapshotsDir(epicFolder);

  migrateEntry(
    "backlog/items",
    join(legacyDir, "items"),
    backlogItemsDir(epicFolder),
    summary
  );
  migrateEntry(
    "backlog/docs",
    join(legacyDir, "docs"),
    backlogDocsDir(epicFolder),
    summary
  );
  migrateEntry(
    "backlog/updates",
    join(legacyDir, "updates"),
    backlogUpdatesDir(epicFolder),
    summary
  );
  migrateEntry(
    "backlog/progress-history.json",
    join(legacyDir, "progress-history.json"),
    backlogProgressHistoryPath(epicFolder),
    summary
  );

  // progress-report-*.html files sit directly under the legacy root — glob
  // by listing entries and matching the filename pattern (the legacy layout
  // predates `.pm/reports/progress/`, so there's no subfolder to move as a
  // unit the way there is for items/docs/updates).
  const legacyEntries = listEntries(legacyDir);
  const reportFiles = legacyEntries.filter((name) =>
    /^progress-report-.*\.html$/.test(name)
  );
  for (const name of reportFiles) {
    migrateEntry(
      `reports/progress/${name}`,
      join(legacyDir, name),
      join(reportsProgressDir(epicFolder), name),
      summary
    );
  }

  // Remove the legacy root once it's empty — either everything above was
  // actually moved this run, or a prior run already emptied it and this run
  // found nothing to do (all `skipped`). Either way, an empty `.snapshots`
  // left behind serves no purpose once `.pm` exists.
  let legacyDirRemoved = false;
  if (pathExistsWithBridge(legacyDir)) {
    const remaining = listEntries(legacyDir);
    if (remaining.length === 0) {
      const result = deleteViaBridge(legacyDir);
      legacyDirRemoved = result.ok;
      if (!result.ok) {
        summary.errors.push(`failed to remove empty legacy dir "${legacyDir}"`);
      }
    }
  }

  return { epicFolder, ...summary, legacyDirRemoved };
}

async function main() {
  const arg = process.argv[2];
  if (!arg || !arg.trim()) {
    process.stderr.write(
      'migrate: usage: migrate-epic-layout.mjs "<groupName>"\n' +
        '         migrate-epic-layout.mjs "<explicit epic folder path>"\n' +
        "The argument is tried first as a `mondayEpics` group name; if that " +
        "resolves to nothing, it is treated as a literal epic folder path.\n"
    );
    process.exit(2);
    return;
  }

  const trimmed = arg.trim();
  const resolvedByGroup = await resolveEpicFolder(trimmed);
  const epicFolder = resolvedByGroup || trimmed;

  if (!pathExistsWithBridge(epicFolder)) {
    process.stderr.write(
      `migrate: epic folder "${epicFolder}" does not exist ` +
        `(resolved from ${resolvedByGroup ? "mondayEpics group" : "literal path argument"}).\n`
    );
    process.exit(2);
    return;
  }

  const summary = migrateEpic(epicFolder);
  printJson(summary);
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});
