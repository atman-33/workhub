#!/usr/bin/env node
// @ts-check
/**
 * save-updates.mjs — fetch a monday.com item's updates (comment/activity feed)
 * and persist them as JSON.
 *
 *   node save-updates.mjs <itemId> [outPath]
 *
 * `fetchItemUpdates` (in `monday-client.mjs`) does the actual query; each
 * update carries both `body` (HTML) and `text_body` (plain text) plus
 * replies, so callers can choose to render HTML or read the plain text
 * without re-fetching. Output path resolution and writing follow the same
 * convention as `save-item.mjs` / `save-doc.mjs`.
 */

import {
  printJson,
  writeFileWithBridge,
  resolveOutPath,
  fetchItemUpdates,
} from "./monday-client.mjs";

async function main() {
  const itemId = process.argv[2];
  if (!itemId || !/^\d+$/.test(itemId.trim())) {
    process.stderr.write(
      "monday: usage: save-updates.mjs <itemId> [outPath]\n"
    );
    process.exit(2);
  }

  const item = await fetchItemUpdates(itemId.trim());
  const payload = {
    itemId: item.id,
    itemName: item.name,
    updates: item.updates,
    savedAt: new Date().toISOString(),
  };
  const content = JSON.stringify(payload, null, 2) + "\n";

  const outArg = process.argv[3];
  const outPath = resolveOutPath(outArg, `${itemId.trim()}.json`);

  const result = writeFileWithBridge(outPath, content);
  if (!result.ok) {
    throw new Error(
      `monday: could not write to "${outPath}" (direct write and powershell bridge both failed)`
    );
  }

  printJson({
    itemId: itemId.trim(),
    outPath,
    bridge: result.bridge,
    count: payload.updates.length,
    bytes: Buffer.byteLength(content, "utf8"),
    saved: true,
  });
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});
