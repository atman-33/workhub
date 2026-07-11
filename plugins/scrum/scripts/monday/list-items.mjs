#!/usr/bin/env node
// @ts-check
/**
 * list-items.mjs — walking-skeleton backlog reader.
 *
 *   node list-items.mjs [boardId]
 *
 * Prints one JSON line per board item ({id, name, group, status}) to stdout
 * (JSON Lines — easy for callers to parse, still human-readable). If no
 * board id is given on the command line, falls back to `mondayBoardId` in
 * `.claude/scrum-context.json` (resolved the same way the SessionStart hook
 * resolves the project root), so the script works with zero args in opencode
 * / CI / bash as long as the config is present.
 *
 * The query deliberately fetches only the columns the skill body needs to
 * render a backlog view: name, group title, and the first status column's
 * label. monday complex-value columns are returned as JSON strings; we
 * surface them verbatim so the agent can decide how much to unpack.
 */

import { mondayFetch, parseBoardIdArg, printJson } from "./monday-client.mjs";

const query = `
  query ListItems($boardId: ID!) {
    boards(ids: [$boardId]) {
      id
      name
      groups {
        id
        title
      }
      items_page(limit: 100) {
        items {
          id
          name
          group {
            id
            title
          }
          column_values(ids: ["status"]) {
            id
            type
            text
          }
        }
      }
    }
  }
`;

/**
 * @param {unknown} raw
 * @returns {string}
 */
function statusText(raw) {
  if (!Array.isArray(raw)) return "";
  for (const col of raw) {
    if (
      col &&
      typeof col === "object" &&
      "text" in col &&
      typeof /** @type {any} */ (col).text === "string"
    ) {
      return /** @type {any} */ (col).text;
    }
  }
  return "";
}

async function main() {
  const boardId = await parseBoardIdArg(process.argv);
  const data = /** @type {{ boards?: Array<{ id: string, name: string, groups: Array<{ id: string, title: string }>, items_page?: { items?: Array<{ id: string, name: string, group?: { id: string, title: string }, column_values?: unknown }> } }> }} */ (
    await mondayFetch(query, { boardId })
  );

  const board = data.boards && data.boards[0];
  if (!board) {
    throw new Error(`monday: board ${boardId} not found or inaccessible`);
  }

  const items = (board.items_page && board.items_page.items) || [];
  for (const item of items) {
    printJson({
      id: item.id,
      name: item.name,
      group: item.group ? item.group.title : "",
      status: statusText(item.column_values),
    });
  }
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});