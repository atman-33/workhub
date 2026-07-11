#!/usr/bin/env node
// @ts-check
/**
 * save-all.mjs — bulk-fetch every item in one monday.com board group (an
 * "Epic") plus each item's attached doc and updates, and lay them out under
 * `<epicFolderPath>` following the workhub Drive convention (see
 * `scripts/lib/layout.mjs`):
 *
 *   <epicFolderPath>/
 *     .pm/backlog/            (machine-managed Epic data root; see layout.mjs)
 *       items/<itemId>.json
 *       docs/<docId>.md      (only for items whose `doc` column has a file)
 *       updates/<itemId>.json
 *     prd/
 *       prd.md               (template, generated once — never overwritten;
 *                              a folder rather than a single file since more
 *                              than one PRD can accumulate over time)
 *
 *   node save-all.mjs <boardId> "<groupName>" <epicFolderPath> [--full]
 *   node save-all.mjs "<groupName>" [epicFolderPath] [--full]
 *
 * `<groupName>` is matched exactly against the board's group titles — monday
 * group ids (e.g. `"topics"`) are per-board internal identifiers, not
 * derivable from the display name, so the board is queried first to resolve
 * the group id.
 *
 * `boardId` and `epicFolderPath` are both optional and fall back to
 * `.claude/scrum-context.json` (`mondayBoardId`, and `mondayEpics[groupName]`
 * for the folder path) — the shape is sniffed from the first positional
 * argument: a numeric value is treated as an explicit boardId, otherwise it
 * is the groupName and boardId comes from config. This lets the common case
 * run as just `save-all.mjs "My Epic"` once both are configured. `--full` is
 * accepted anywhere on the command line and is stripped before positional
 * parsing.
 *
 * Reuses `fetchDocMarkdown` / `fetchItemUpdates` from `monday-client.mjs`
 * (the same queries `save-doc.mjs` / `save-updates.mjs` use) so single-item
 * behaviour stays identical whether fetched one at a time or in bulk here.
 * `prd/prd.md` is written with `skipIfExists: true` so a user's manual edits
 * are never clobbered by re-running this script.
 *
 * Incremental snapshot: each item's `updated_at` (from the board listing) is
 * compared against the `updatedAt` already stored in
 * `.pm/backlog/items/<id>.json`; when unchanged, the doc/updates fetches
 * (the two extra API round trips per item) are skipped — but the item JSON
 * is still rewritten with a fresh `savedAt` so `generate-progress-report.mjs`'s
 * 15-minute batch-freshness window (`BATCH_WINDOW_MS`) keeps working exactly
 * as it does for a full run. Pass `--full` to force the old always-refetch
 * behaviour (e.g. after an out-of-band docs/updates edit on monday).
 *
 * Migration guard: if the Epic folder still has a legacy `<epic>/.snapshots/`
 * and no `<epic>/.pm/` yet, this exits with a JSON error instead of writing
 * anywhere — run `scripts/setup/migrate-epic-layout.mjs` first.
 */

import { join } from "node:path";
import {
  mondayFetch,
  parseBoardIdArg,
  printJson,
  writeFileWithBridge,
  readFileWithBridge,
  pathExistsWithBridge,
  fetchDocMarkdown,
  fetchItemUpdates,
  resolveEpicFolder,
} from "./monday-client.mjs";
import {
  pmRoot,
  legacySnapshotsDir,
  backlogItemsDir,
  backlogDocsDir,
  backlogUpdatesDir,
} from "../lib/layout.mjs";

const BOARD_GROUPS_QUERY = `
  query BoardGroups($boardId: ID!) {
    boards(ids: [$boardId]) {
      id
      name
      groups { id title }
    }
  }
`;

const GROUP_ITEMS_QUERY = `
  query GroupItems($boardId: ID!, $groupIds: [String]) {
    boards(ids: [$boardId]) {
      groups(ids: $groupIds) {
        id
        title
        items_page(limit: 100) {
          items {
            id
            name
            updated_at
            column_values { id type text value }
          }
        }
      }
    }
  }
`;

/**
 * @typedef {{ id: string, type: string, text: string, value: string | null }} ColumnValue
 */

/**
 * Find the doc-column `objectId` on an item's column_values, if any: the
 * first `doc`-typed column whose value has at least one attached file.
 * Returns null when the item has no doc attached.
 * @param {ColumnValue[]} columnValues
 * @returns {string | null}
 */
function findDocObjectId(columnValues) {
  for (const col of columnValues) {
    if (col.type !== "doc" || !col.value) continue;
    let parsed;
    try {
      parsed = JSON.parse(col.value);
    } catch {
      continue;
    }
    const file =
      parsed && Array.isArray(parsed.files) ? parsed.files[0] : null;
    if (file && file.objectId) return String(file.objectId);
  }
  return null;
}

/**
 * @param {string} groupName
 * @returns {string}
 */
function prdTemplate(groupName) {
  return `# ${groupName} PRD\n\n## 背景・目的\n\n(記入してください)\n\n## スコープ\n\n(記入してください)\n\n## 参考\n\n- monday.com group: ${groupName}\n`;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const fullMode = rawArgs.includes("--full");
  const positional = rawArgs.filter((a) => a !== "--full");

  const arg2 = positional[0];
  const boardIdIsExplicit = Boolean(arg2 && /^\d+$/.test(arg2.trim()));

  const groupName = boardIdIsExplicit ? positional[1] : positional[0];
  const epicFolderArg = boardIdIsExplicit ? positional[2] : positional[1];

  if (!groupName) {
    process.stderr.write(
      'monday: usage: save-all.mjs [boardId] "<groupName>" [epicFolderPath] [--full]\n' +
        "boardId falls back to `mondayBoardId`, epicFolderPath falls back to " +
        "`mondayEpics[groupName]`, both read from `.claude/scrum-context.json`.\n"
    );
    process.exit(2);
  }

  // Force config fallback by passing an argv with an empty boardId slot when
  // the caller didn't supply one explicitly (see module docstring above).
  const boardId = boardIdIsExplicit
    ? arg2.trim()
    : await parseBoardIdArg(["", "", ""]);

  const epicFolder = epicFolderArg || (await resolveEpicFolder(groupName));
  if (!epicFolder) {
    process.stderr.write(
      `monday: no epicFolderPath given and no mondayEpics["${groupName}"] ` +
        "configured in `.claude/scrum-context.json`.\n"
    );
    process.exit(2);
  }

  // Migration guard: a legacy `.snapshots` folder with no `.pm` yet means
  // this Epic hasn't been migrated to the current layout — refuse to write
  // (which would otherwise start a second, `.pm`-shaped copy alongside the
  // untouched legacy one) and point at the migration script instead.
  if (
    pathExistsWithBridge(legacySnapshotsDir(epicFolder)) &&
    !pathExistsWithBridge(pmRoot(epicFolder))
  ) {
    printJson({
      error: "legacy-layout-not-migrated",
      message:
        `monday: "${epicFolder}" still has a legacy .snapshots/ folder and no .pm/ ` +
        "folder yet. Run `node scripts/setup/migrate-epic-layout.mjs " +
        `"${groupName}"\` first, then re-run save-all.mjs.`,
      epicFolder,
    });
    process.exit(1);
  }

  const boardData =
    /** @type {{ boards?: Array<{ id: string, name: string, groups: Array<{ id: string, title: string }> }> }} */ (
      await mondayFetch(BOARD_GROUPS_QUERY, { boardId })
    );
  const board = boardData.boards && boardData.boards[0];
  if (!board) {
    throw new Error(`monday: board ${boardId} not found or inaccessible`);
  }
  const group = board.groups.find((g) => g.title === groupName);
  if (!group) {
    process.stderr.write(
      `monday: group "${groupName}" not found on board "${board.name}" (${board.id}).\n` +
        `Available groups: ${board.groups
          .map((g) => `"${g.title}"`)
          .join(", ")}\n`
    );
    process.exit(3);
  }

  const itemsData =
    /** @type {{ boards?: Array<{ groups: Array<{ id: string, title: string, items_page?: { items?: Array<{ id: string, name: string, updated_at?: string, column_values?: ColumnValue[] }> } }> }> }} */ (
      await mondayFetch(GROUP_ITEMS_QUERY, {
        boardId: boardId.trim(),
        groupIds: [group.id],
      })
    );
  const groupData =
    itemsData.boards && itemsData.boards[0] && itemsData.boards[0].groups[0];
  const items = (groupData && groupData.items_page && groupData.items_page.items) || [];

  const itemsDir = backlogItemsDir(epicFolder);
  const docsDir = backlogDocsDir(epicFolder);
  const updatesDir = backlogUpdatesDir(epicFolder);

  /** @type {string[]} */
  const itemsSaved = [];
  /** @type {string[]} */
  const docsSaved = [];
  /** @type {string[]} */
  const updatesSaved = [];
  /** @type {string[]} */
  const errors = [];
  let skippedUnchanged = 0;

  for (const item of items) {
    const columnValues = item.column_values || [];
    const updatedAt = item.updated_at || null;

    // Incremental diff: skip the doc/updates round trips (the expensive
    // part) for items whose `updated_at` matches the previously saved
    // snapshot — unless --full was passed. The item JSON itself is always
    // rewritten below (cheap: already fetched in bulk above), with a fresh
    // `savedAt` so generate-progress-report.mjs's freshness window still
    // treats this as part of the current batch.
    let previouslyUpdatedAt = null;
    if (!fullMode) {
      const existingRaw = readFileWithBridge(join(itemsDir, `${item.id}.json`));
      if (existingRaw) {
        try {
          const existing = JSON.parse(existingRaw);
          previouslyUpdatedAt = existing && existing.updatedAt ? existing.updatedAt : null;
        } catch {
          previouslyUpdatedAt = null;
        }
      }
    }
    const isUnchanged =
      !fullMode && updatedAt && previouslyUpdatedAt && updatedAt === previouslyUpdatedAt;

    const itemPath = join(itemsDir, `${item.id}.json`);
    const itemPayload = {
      id: item.id,
      name: item.name,
      group: group.title,
      board: { id: board.id, name: board.name },
      column_values: columnValues,
      updatedAt,
      savedAt: new Date().toISOString(),
    };
    const itemResult = writeFileWithBridge(
      itemPath,
      JSON.stringify(itemPayload, null, 2) + "\n"
    );
    if (itemResult.ok) itemsSaved.push(item.id);
    else errors.push(`item ${item.id}: write to "${itemPath}" failed`);

    if (isUnchanged) {
      skippedUnchanged += 1;
      continue;
    }

    const docObjectId = findDocObjectId(columnValues);
    if (docObjectId) {
      try {
        const doc = await fetchDocMarkdown(docObjectId);
        const docPath = join(docsDir, `${doc.id}.md`);
        const docResult = writeFileWithBridge(docPath, doc.markdown);
        if (docResult.ok) docsSaved.push(doc.id);
        else errors.push(`doc ${doc.id} (item ${item.id}): write failed`);
      } catch (err) {
        errors.push(
          `doc for item ${item.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    try {
      const updates = await fetchItemUpdates(item.id);
      const updatesPath = join(updatesDir, `${item.id}.json`);
      const updatesPayload = {
        itemId: updates.id,
        itemName: updates.name,
        updates: updates.updates,
        savedAt: new Date().toISOString(),
      };
      const updatesResult = writeFileWithBridge(
        updatesPath,
        JSON.stringify(updatesPayload, null, 2) + "\n"
      );
      if (updatesResult.ok) updatesSaved.push(item.id);
      else errors.push(`updates for item ${item.id}: write failed`);
    } catch (err) {
      errors.push(
        `updates for item ${item.id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const prdPath = join(epicFolder, "prd", "prd.md");
  const prdResult = writeFileWithBridge(prdPath, prdTemplate(group.title), {
    skipIfExists: true,
  });

  printJson({
    boardId: board.id,
    boardName: board.name,
    group: group.title,
    itemCount: items.length,
    itemsSaved,
    docsSaved,
    updatesSaved,
    skippedUnchanged,
    fullMode,
    prd: { path: prdPath, skipped: prdResult.skipped, bridge: prdResult.bridge },
    errors,
  });
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});
