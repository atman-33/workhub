#!/usr/bin/env node
// @ts-check
/**
 * get-item.mjs — fetch a single monday.com item by id.
 *
 *   node get-item.mjs <itemId>
 *
 * Prints one JSON object ({id, name, group, column_values}) to stdout. This
 * is the "walking skeleton" minimal end-to-end check: fetch one item's name +
 * status and display it. `column_values` is the monday complex-value column
 * payload returned as a JSON string per column, so the agent can decide how
 * to render priority / dates / mirrors without us over-parsing here.
 */

import { mondayFetch, printJson } from "./monday-client.mjs";

const query = `
  query GetItem($itemId: ID!) {
    items(ids: [$itemId]) {
      id
      name
      group {
        id
        title
      }
      board {
        id
        name
      }
      column_values {
        id
        type
        text
        value
      }
    }
  }
`;

async function main() {
  const itemId = process.argv[2];
  if (!itemId || !/^\d+$/.test(itemId.trim())) {
    process.stderr.write(
      "monday: an item id is required.\nUsage: get-item.mjs <itemId>\n"
    );
    process.exit(2);
  }

  const data = /** @type {{ items?: Array<{ id: string, name: string, group?: { id: string, title: string }, board?: { id: string, name: string }, column_values?: unknown }> }} */ (
    await mondayFetch(query, { itemId: itemId.trim() })
  );

  const item = data.items && data.items[0];
  if (!item) {
    throw new Error(`monday: item ${itemId} not found or inaccessible`);
  }

  printJson({
    id: item.id,
    name: item.name,
    group: item.group ? item.group.title : "",
    board: item.board ? { id: item.board.id, name: item.board.name } : null,
    column_values: item.column_values ?? [],
  });
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});