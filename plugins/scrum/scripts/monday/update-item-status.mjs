#!/usr/bin/env node
// @ts-check
/**
 * update-item-status.mjs — set the status column of one monday.com item.
 *
 *   node update-item-status.mjs <itemId> "<StatusLabel>"
 *
 * Walking skeleton of the write path. monday.com status columns store their
 * value as a label index inside a `color`-typed column; this script does the
 * two-step lookup:
 *
 *   1. `items(ids)` -> resolve the item's `board.id` and read back that
 *      board's column list, choosing the first `status`-typed column as the
 *      "status" column (the monday default).
 *   2. Parse that column's `settings_str` to map the requested label text to
 *      its numeric index, then call `change_column_value` with the canonical
 *      `{"index": N}` payload.
 *
 * monday.com changes are visible to the whole workspace, so the calling skill
 * is expected to have already confirmed the board/group with the user — this
 * script performs the mutation it is told to perform and does not prompt.
 */

import { mondayFetch, printJson } from "./monday-client.mjs";

const BOARD_QUERY = `
  query GetItemBoard($itemId: ID!) {
    items(ids: [$itemId]) {
      board {
        id
        name
        columns {
          id
          title
          type
          settings_str
        }
      }
    }
  }
`;

// monday updates return the changed column's text — surfaces as status label.
const UPDATE_MUTATION = `
  mutation UpdateItemStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(
      board_id: $boardId
      item_id: $itemId
      column_id: $columnId
      value: $value
    ) {
      id
      name
    }
  }
`;

/**
 * Parse the status column's `settings_str` (a JSON string) and return the
 * numeric index whose label matches `label` (case-insensitive, trimmed). The
 * monday shape is `{"labels": {"0":"Working on it","2":"Done"}, ...}` — keys
 * are string indices into the status palette.
 * @param {string} settingsStr
 * @param {string} label
 * @returns {number | null}
 */
function findLabelIndex(settingsStr, label) {
  if (!settingsStr) return null;
  let settings;
  try {
    settings = JSON.parse(settingsStr);
  } catch {
    return null;
  }
  const labels =
    settings && typeof settings === "object" && "labels" in settings
      ? /** @type {Record<string, string>} */ (settings.labels)
      : null;
  if (!labels) return null;

  const target = label.trim().toLowerCase();
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v === "string" && v.trim().toLowerCase() === target) {
      const n = Number(k);
      if (Number.isInteger(n)) return n;
    }
  }
  return null;
}

/**
 * Print the available labels for a column to stderr, so the agent / user can
 * see what the board actually accepts when an unknown label is requested.
 * @param {string} settingsStr
 */
function listLabels(settingsStr) {
  if (!settingsStr) return;
  let settings;
  try {
    settings = JSON.parse(settingsStr);
  } catch {
    return;
  }
  const labels =
    settings && typeof settings === "object" && "labels" in settings
      ? /** @type {Record<string, string>} */ (settings.labels)
      : null;
  if (!labels) return;
  process.stderr.write(
    "Available status labels on this board: " +
      Object.values(labels)
        .filter((/** @param {unknown} v */ v) => typeof v === "string")
        .map((/** @param {string} v */ v) => `"${v}"`)
        .join(", ") +
      "\n"
  );
}

async function main() {
  const itemId = process.argv[2];
  const label = process.argv[3];
  if (!itemId || !/^\d+$/.test(itemId.trim()) || !label || !label.trim()) {
    process.stderr.write(
      "monday: usage: update-item-status.mjs <itemId> \"<StatusLabel>\"\n"
    );
    process.exit(2);
  }

  const boardData = /** @type {{ items?: Array<{ board?: { id: string, name: string, columns?: Array<{ id: string, title: string, type: string, settings_str: string }> } }> }} */ (
    await mondayFetch(BOARD_QUERY, { itemId: itemId.trim() })
  );
  const board = boardData.items && boardData.items[0] && boardData.items[0].board;
  if (!board) {
    throw new Error(`monday: item ${itemId} not found or inaccessible`);
  }

  const statusCol = (board.columns || []).find(
    (c) => c.type === "status" || c.type === "color"
  );
  if (!statusCol) {
    throw new Error(
      `monday: board "${board.name}" (${board.id}) has no status ("status" type) column`
    );
  }

  const index = findLabelIndex(statusCol.settings_str, label);
  if (index === null) {
    process.stderr.write(
      `monday: status label "${label}" not found on column "${statusCol.title}"\n`
    );
    listLabels(statusCol.settings_str);
    process.exit(3);
  }

  // monday expects the column value as a JSON-encoded string, so we
  // `JSON.stringify` twice: once for the inner object, once for the GraphQL
  // `JSON` scalar wrapper that monday's API accepts.
  const valueJson = JSON.stringify({ index });

  await mondayFetch(UPDATE_MUTATION, {
    boardId: board.id,
    itemId: itemId.trim(),
    columnId: statusCol.id,
    value: valueJson,
  });

  printJson({
    itemId: itemId.trim(),
    boardId: board.id,
    columnId: statusCol.id,
    label,
    index,
    updated: true,
  });
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});