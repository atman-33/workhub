#!/usr/bin/env node
// @ts-check
/**
 * set-link.mjs — set one `link`-typed column on a monday.com item or
 * subitem, resolved by column *title* (never by id — monday generates a
 * random id suffix per board, e.g. `link_mm4y5g57`).
 *
 *   node set-link.mjs <itemId> "<columnTitle>" <url> [text]
 *
 * This script does not resolve any link itself — it only performs the
 * write. It exists to overwrite an interim `file:///G:/...` URI (written by
 * `init-task.mjs` when it scaffolds acceptance.md/tasks.md, or already
 * present on an older item) with a real, portable link once one has been
 * resolved — e.g. a Google Drive `viewUrl` found via the Google Drive MCP
 * connector's `search_files` tool (see the `manage-monday-backlog` skill's
 * "Resolving real Drive links for pbi link columns" section). `text`
 * defaults to `url` when omitted.
 *
 * monday.com changes are visible to the whole workspace; as with
 * `update-item-status.mjs` / `init-task.mjs`, the calling skill is expected
 * to have already confirmed the target/URL with the user, so this script
 * performs the write without prompting.
 */

import {
  mondayFetch,
  printJson,
  findLinkColumnByTitle,
  setLinkColumn,
} from "./monday-client.mjs";

const ITEM_BOARD_QUERY = `
  query GetItemBoardForLink($itemId: ID!) {
    items(ids: [$itemId]) {
      board {
        id
        name
        columns {
          id
          title
          type
        }
      }
    }
  }
`;

async function main() {
  const itemId = process.argv[2];
  const columnTitle = process.argv[3];
  const url = process.argv[4];
  const text = process.argv[5] || url;

  if (
    !itemId ||
    !/^\d+$/.test(itemId.trim()) ||
    !columnTitle ||
    !columnTitle.trim() ||
    !url ||
    !url.trim()
  ) {
    process.stderr.write(
      'monday: usage: set-link.mjs <itemId> "<columnTitle>" <url> [text]\n'
    );
    process.exit(2);
  }

  const data =
    /** @type {{ items?: Array<{ board?: { id: string, name: string, columns?: Array<{ id: string, title: string, type: string }> } }> }} */ (
      await mondayFetch(ITEM_BOARD_QUERY, { itemId: itemId.trim() })
    );
  const board = data.items && data.items[0] && data.items[0].board;
  if (!board) {
    throw new Error(`monday: item ${itemId} not found or inaccessible`);
  }

  const columnId = findLinkColumnByTitle(board.columns || [], columnTitle);
  if (!columnId) {
    process.stderr.write(
      `monday: no "link"-typed column titled "${columnTitle}" on board "${board.name}" (${board.id})\n` +
        "Available link columns: " +
        (board.columns || [])
          .filter((c) => c.type === "link")
          .map((c) => `"${c.title}"`)
          .join(", ") +
        "\n"
    );
    process.exit(3);
  }

  await setLinkColumn(board.id, itemId.trim(), columnId, url.trim(), text.trim());

  printJson({
    itemId: itemId.trim(),
    boardId: board.id,
    column: columnTitle,
    columnId,
    url: url.trim(),
    text: text.trim(),
    updated: true,
  });
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});
