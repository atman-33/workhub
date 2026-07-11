#!/usr/bin/env node
// @ts-check
/**
 * check-stale-links.mjs — detect `link`-typed columns on a monday.com item
 * that still hold an interim `file:///G:/...` URI written by `init-task.mjs`,
 * instead of a real, portable link (e.g. a resolved `https://drive.google.com/...`
 * URL).
 *
 *   node check-stale-links.mjs <itemId>
 *
 * This is the mechanical counterpart to the `manage-monday-backlog` skill's
 * "Resolving real Drive links for pbi link columns" recipe: after resolving
 * one or more link columns with `set-link.mjs`, run this script to confirm
 * none were missed, instead of relying on remembering to repeat the recipe
 * for every link column on the item.
 *
 * Prints one JSON object `{ itemId, boardId, staleLinks, ok }` to stdout,
 * where `staleLinks` is `[{ column, columnId, url }]` for every `link`
 * column whose value still starts with `file://` (case-insensitive). Exits
 * with code 4 when `staleLinks` is non-empty, 0 otherwise — see this skill's
 * "Failure modes" section.
 */

import { mondayFetch, printJson } from "./monday-client.mjs";

const ITEM_LINKS_QUERY = `
  query GetItemLinks($itemId: ID!) {
    items(ids: [$itemId]) {
      id
      board {
        id
        columns {
          id
          title
          type
        }
      }
      column_values {
        id
        type
        value
      }
    }
  }
`;

async function main() {
  const itemId = process.argv[2];
  if (!itemId || !/^\d+$/.test(itemId.trim())) {
    process.stderr.write(
      "monday: usage: check-stale-links.mjs <itemId>\n"
    );
    process.exit(2);
  }

  const data =
    /** @type {{ items?: Array<{ id: string, board?: { id: string, columns?: Array<{ id: string, title: string, type: string }> }, column_values?: Array<{ id: string, type: string, value: string | null }> }> }} */ (
      await mondayFetch(ITEM_LINKS_QUERY, { itemId: itemId.trim() })
    );
  const item = data.items && data.items[0];
  if (!item || !item.board) {
    throw new Error(`monday: item ${itemId} not found or inaccessible`);
  }

  const titleById = new Map(
    (item.board.columns || [])
      .filter((c) => c.type === "link")
      .map((c) => [c.id, c.title])
  );

  /** @type {Array<{ column: string, columnId: string, url: string }>} */
  const staleLinks = [];
  for (const cv of item.column_values || []) {
    if (!titleById.has(cv.id) || !cv.value) continue;
    /** @type {{ url?: string }} */
    let parsed;
    try {
      parsed = JSON.parse(cv.value);
    } catch {
      continue;
    }
    if (typeof parsed.url === "string" && /^file:\/\//i.test(parsed.url)) {
      staleLinks.push({
        column: titleById.get(cv.id) ?? cv.id,
        columnId: cv.id,
        url: parsed.url,
      });
    }
  }

  printJson({
    itemId: item.id,
    boardId: item.board.id,
    staleLinks,
    ok: staleLinks.length === 0,
  });

  if (staleLinks.length > 0) {
    process.exit(4);
  }
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});
