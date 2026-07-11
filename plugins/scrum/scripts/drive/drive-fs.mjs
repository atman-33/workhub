#!/usr/bin/env node
// @ts-check
/**
 * drive-fs.mjs — general-purpose folder/file management for a Google Drive
 * for desktop sync folder, reachable on WSL even when the drive is not
 * mounted at `/mnt/<drive>` (via the `powershell.exe` bridge in
 * `drive-bridge.mjs`).
 *
 *   node drive-fs.mjs list <dirPath>
 *   node drive-fs.mjs exists <path>
 *   node drive-fs.mjs mkdir <dirPath>
 *   node drive-fs.mjs move <fromPath> <toPath>
 *   node drive-fs.mjs delete <path>
 *   node drive-fs.mjs read <path>
 *   node drive-fs.mjs write <path>          # content read from stdin
 *
 * This complements the `manage-drive-docs` skill's Read/Edit/Write-tool-based
 * content editing: use this script when the standard `Read`/`Edit`/`Write`
 * tools cannot reach the path (WSL with the drive not mounted at
 * `/mnt/<drive>`, or a non-ASCII path that mounts but reads back garbled),
 * and for structural operations (renaming, moving, deleting, listing) that
 * `Read`/`Edit`/`Write` cannot do at all. A hand-rolled `powershell.exe`
 * command gets three things wrong in easy-to-miss ways:
 *
 *   1. Non-ASCII (e.g. Japanese) directory listings come back garbled unless
 *      `[Console]::OutputEncoding` is forced to UTF-8 first — `list` already
 *      does this; do not hand-write `Get-ChildItem` yourself.
 *   2. `delete` takes exactly one explicit path and never a
 *      wildcard/pattern/loop — Claude Code's auto-mode classifier blocks
 *      bulk/pattern-based destructive operations. Resolve the exact target
 *      with `list` first, confirm it with the user, then call `delete` on
 *      that one path.
 *   3. Piping non-ASCII file *content* through `powershell.exe`'s stdout
 *      garbles it even with UTF-8 console output forced — `read` avoids this
 *      by copying the file as bytes to a local temp file instead (see
 *      `readFileViaBridge` in `drive-bridge.mjs`).
 */

import {
  isWindowsDrivePath,
  pathExistsViaPowershell,
  listDirEntriesDetailed,
  mkdirViaBridge,
  moveViaBridge,
  deleteViaBridge,
  tryDirectRead,
  readFileViaBridge,
  tryDirectWrite,
  writeViaPowershell,
} from "./drive-bridge.mjs";
import { existsSync, readFileSync } from "node:fs";

/** @param {unknown} value */
function printJson(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

/** @param {string} path */
function pathExists(path) {
  if (existsSync(path)) return true;
  if (isWindowsDrivePath(path)) return pathExistsViaPowershell(path);
  return false;
}

/** @param {string} dirPath */
function cmdList(dirPath) {
  if (!dirPath) {
    process.stderr.write("drive-fs: usage: list <dirPath>\n");
    process.exit(2);
  }
  const entries = listDirEntriesDetailed(dirPath);
  for (const entry of entries) {
    printJson(entry);
  }
}

/** @param {string} path */
function cmdExists(path) {
  if (!path) {
    process.stderr.write("drive-fs: usage: exists <path>\n");
    process.exit(2);
  }
  printJson({ path, exists: pathExists(path) });
}

/** @param {string} dirPath */
function cmdMkdir(dirPath) {
  if (!dirPath) {
    process.stderr.write("drive-fs: usage: mkdir <dirPath>\n");
    process.exit(2);
  }
  const result = mkdirViaBridge(dirPath);
  printJson({ path: dirPath, ...result });
}

/**
 * @param {string} fromPath
 * @param {string} toPath
 */
function cmdMove(fromPath, toPath) {
  if (!fromPath || !toPath) {
    process.stderr.write("drive-fs: usage: move <fromPath> <toPath>\n");
    process.exit(2);
  }
  const result = moveViaBridge(fromPath, toPath);
  printJson({ from: fromPath, to: toPath, ...result });
}

/** @param {string} path */
function cmdDelete(path) {
  if (!path) {
    process.stderr.write("drive-fs: usage: delete <path>\n");
    process.exit(2);
  }
  const result = deleteViaBridge(path);
  printJson({ path, ...result });
}

/** @param {string} path */
function cmdRead(path) {
  if (!path) {
    process.stderr.write("drive-fs: usage: read <path>\n");
    process.exit(2);
  }
  const direct = tryDirectRead(path);
  if (direct.ok) {
    printJson({ path, ok: true, bridge: false, content: direct.content });
    return;
  }
  if (!isWindowsDrivePath(path)) {
    printJson({ path, ok: false, bridge: false });
    process.exit(1);
  }
  const result = readFileViaBridge(path);
  printJson({ path, ...result });
  if (!result.ok) process.exit(1);
}

/** @param {string} path */
function cmdWrite(path) {
  if (!path) {
    process.stderr.write("drive-fs: usage: write <path>  (content read from stdin)\n");
    process.exit(2);
  }
  const content = readFileSync(0, "utf8");
  if (tryDirectWrite(path, content)) {
    printJson({ path, ok: true, bridge: false });
    return;
  }
  if (!isWindowsDrivePath(path)) {
    printJson({ path, ok: false, bridge: false });
    process.exit(1);
  }
  const ok = writeViaPowershell(path, content);
  printJson({ path, ok, bridge: true });
  if (!ok) process.exit(1);
}

function main() {
  const [, , subcommand, arg1, arg2] = process.argv;
  switch (subcommand) {
    case "list":
      cmdList(arg1);
      return;
    case "exists":
      cmdExists(arg1);
      return;
    case "mkdir":
      cmdMkdir(arg1);
      return;
    case "move":
      cmdMove(arg1, arg2);
      return;
    case "delete":
      cmdDelete(arg1);
      return;
    case "read":
      cmdRead(arg1);
      return;
    case "write":
      cmdWrite(arg1);
      return;
    default:
      process.stderr.write(
        "drive-fs: usage:\n" +
          "  drive-fs.mjs list <dirPath>\n" +
          "  drive-fs.mjs exists <path>\n" +
          "  drive-fs.mjs mkdir <dirPath>\n" +
          "  drive-fs.mjs move <fromPath> <toPath>\n" +
          "  drive-fs.mjs delete <path>\n" +
          "  drive-fs.mjs read <path>\n" +
          "  drive-fs.mjs write <path>  (content read from stdin)\n"
      );
      process.exit(2);
  }
}

main();
