#!/usr/bin/env node
// @ts-check
/**
 * save-item.mjs — fetch one monday.com item and persist its JSON to disk.
 *
 *   node save-item.mjs <itemId> [outPath]
 *
 * Walking skeleton of the "snapshot to Google Drive" path. Fetches the same
 * item payload `get-item.mjs` returns, then writes the pretty-printed JSON
 * to `outPath`:
 *
 *   - omitted          -> `./monday-item-<itemId>.json` (local fallback)
 *   - a directory      -> `<dir>/monday-item-<itemId>.json`
 *   - a file path      -> that file exactly
 *
 * Path forms are accepted verbatim, so the same script works on Windows
 * native, WSL with `/mnt/<drive>/...` mounted, and WSL with only the Windows
 * drive form reachable via `powershell.exe`. When the destination starts
 * with a Windows drive letter (e.g. `G:\\...`) and Node cannot write to it
 * directly, the shared `writeFileWithBridge` helper falls back to a
 * `powershell.exe`-bridged copy via the `\\wsl.localhost` UNC path.
 *
 * The fetch uses the same `mondayFetch` plumbing as the other CLI scripts,
 * so `MONDAY_TOKEN` resolution and error handling are identical.
 */

import {
  printJson,
  writeFileWithBridge,
  resolveOutPath,
  fetchItemSnapshot,
} from "./monday-client.mjs";

async function main() {
  const itemId = process.argv[2];
  if (!itemId || !/^\d+$/.test(itemId.trim())) {
    process.stderr.write(
      "monday: usage: save-item.mjs <itemId> [outPath]\n"
    );
    process.exit(2);
  }

  const item = await fetchItemSnapshot(itemId.trim());
  const payload = { ...item, savedAt: new Date().toISOString() };
  const content = JSON.stringify(payload, null, 2) + "\n";

  const outArg = process.argv[3];
  const outPath = resolveOutPath(
    outArg,
    `monday-item-${itemId.trim()}.json`
  );

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
