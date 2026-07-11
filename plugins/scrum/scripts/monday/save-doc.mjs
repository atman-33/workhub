#!/usr/bin/env node
// @ts-check
/**
 * save-doc.mjs — fetch a monday.com doc's content and persist it as Markdown.
 *
 *   node save-doc.mjs <docIdOrObjectId> [outPath]
 *
 * A monday "doc" column's value embeds an `objectId` (also the id used in the
 * doc's `/docs/<id>` URL), which is *not* the same as the doc's own internal
 * id. `fetchDocMarkdown` (in `monday-client.mjs`) resolves either form and
 * renders the doc's blocks as Markdown; this script is a thin CLI wrapper
 * that only handles argument parsing and output.
 *
 * Output path resolution and writing follow the same convention as
 * `save-item.mjs` (see `resolveOutPath` / `writeFileWithBridge` in
 * `monday-client.mjs`), including the `powershell.exe` bridge for Windows
 * drive paths on WSL.
 */

import {
  printJson,
  writeFileWithBridge,
  resolveOutPath,
  fetchDocMarkdown,
} from "./monday-client.mjs";

async function main() {
  const idArg = process.argv[2];
  if (!idArg || !/^\d+$/.test(idArg.trim())) {
    process.stderr.write(
      "monday: usage: save-doc.mjs <docIdOrObjectId> [outPath]\n"
    );
    process.exit(2);
  }

  const doc = await fetchDocMarkdown(idArg.trim());

  const outArg = process.argv[3];
  const outPath = resolveOutPath(outArg, `${doc.id}.md`);

  const result = writeFileWithBridge(outPath, doc.markdown);
  if (!result.ok) {
    throw new Error(
      `monday: could not write to "${outPath}" (direct write and powershell bridge both failed)`
    );
  }

  printJson({
    docId: doc.id,
    name: doc.name,
    outPath,
    bridge: result.bridge,
    bytes: Buffer.byteLength(doc.markdown, "utf8"),
    saved: true,
  });
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});
