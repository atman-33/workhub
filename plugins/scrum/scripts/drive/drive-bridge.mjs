#!/usr/bin/env node
// @ts-check
/**
 * Shared, monday-agnostic bridge for reaching a Windows drive-letter path
 * (e.g. `G:\マイドライブ\...`, a Google Drive for desktop sync folder) from
 * WSL when the drive is not mounted at `/mnt/<drive>`. Node's `fs` calls are
 * always tried first (works on Windows native, and on WSL when the drive
 * happens to be mounted); when that fails and the path looks like a Windows
 * drive path, every primitive here falls back to a `powershell.exe` call via
 * the `\\wsl.localhost\<distro>\...` UNC bridge.
 *
 * Exposes:
 *   - `isWindowsDrivePath(p)` -> true for `G:\...` / `G:/...` style paths.
 *   - `tryDirectRead(path)` / `readFileViaBridge(winPath)` -> file *content*
 *     read, used by `drive-fs.mjs`'s `read` subcommand. The bridge path never
 *     pipes text through `powershell.exe`'s stdout — Windows PowerShell 5.1
 *     garbles non-ASCII (e.g. Japanese) text through a captured stdout pipe
 *     even after forcing `[Console]::OutputEncoding`. Instead it
 *     `Copy-Item`s the source file as bytes to a local WSL temp file via the
 *     UNC bridge and reads that file directly with Node — a binary copy has
 *     no text encoding to get wrong.
 *   - `tryDirectWrite(outPath, content)` / `writeViaPowershell(...)` -> the
 *     write path used by `writeFileWithBridge` in `monday-client.mjs`, and by
 *     `drive-fs.mjs`'s `write` subcommand.
 *   - `pathExistsViaPowershell(path)` / `listDirEntriesViaPowershell(dir)` /
 *     `listDirEntriesDetailed(dir)` -> read-only existence/listing checks.
 *     The listing helpers force UTF-8 console output first — Windows
 *     PowerShell 5.1's default console encoding garbles non-ASCII (e.g.
 *     Japanese) filenames otherwise.
 *   - `mkdirViaBridge(dirPath)` / `moveViaBridge(from, to)` /
 *     `deleteViaBridge(path)` -> single-target directory/file management
 *     operations, used by `drive-fs.mjs`. There is deliberately no
 *     wildcard/pattern/bulk variant of any of these — Claude Code's
 *     auto-mode classifier blocks pattern-based bulk destructive operations,
 *     and requiring one explicit path per call keeps every mutation
 *     reviewable.
 *
 * Dependency-free (Node 18+), no platform branching in callers — the same
 * calls work on Windows native and WSL.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PS_PATH = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

/**
 * Detect a Windows drive-letter path like `G:\\...` or `G:/...`. Used to
 * decide whether to attempt the powershell bridge when a direct Node
 * operation is not possible (WSL without the drive mounted under `/mnt`).
 * @param {string} p
 * @returns {boolean}
 */
export function isWindowsDrivePath(p) {
  return /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Try to read `path` as a UTF-8 string directly via Node fs. Returns
 * `{ ok: true, content }` on success, `{ ok: false }` on any failure (so
 * callers can fall back to the powershell bridge without throwing here).
 *
 * Skips the attempt entirely (returns `{ ok: false }` immediately) when not
 * running on Windows and `path` looks like a Windows drive path (`G:\...`) —
 * on WSL, `readFileSync` on a backslash-style path doesn't throw, it just
 * looks for (or creates, for the write counterpart) a file literally named
 * with those backslashes in the current directory, since POSIX path parsing
 * doesn't treat `\` as a separator. Without this guard the "direct" attempt
 * can silently read/write the wrong file instead of falling back to the
 * bridge.
 * @param {string} path
 * @returns {{ ok: boolean, content?: string }}
 */
export function tryDirectRead(path) {
  if (process.platform !== "win32" && isWindowsDrivePath(path)) {
    return { ok: false };
  }
  try {
    return { ok: true, content: readFileSync(path, "utf8") };
  } catch {
    return { ok: false };
  }
}

/**
 * Read a Windows drive-letter path `winPath` as a UTF-8 string by copying it
 * to a local temp file via `powershell.exe Copy-Item` over the
 * `\\wsl.localhost\<distro>\...` UNC bridge, then reading that local copy
 * directly with Node. This deliberately avoids piping the file's text through
 * `powershell.exe`'s stdout: Windows PowerShell 5.1 garbles non-ASCII (e.g.
 * Japanese) text captured that way even after forcing
 * `[Console]::OutputEncoding` to UTF-8, whereas `Copy-Item` moves raw bytes
 * with no text encoding involved.
 *
 * The wsl.localhost distro name is read from `WSL_DISTRO_NAME` (set by WSL on
 * session start); if missing, falls back to `Ubuntu` which is the default.
 * On Windows native this function is not reached (direct read succeeds).
 * @param {string} winPath
 * @returns {{ ok: boolean, bridge: boolean, content?: string }}
 */
export function readFileViaBridge(winPath) {
  if (!existsSync(PS_PATH)) return { ok: false, bridge: true };

  const distro = process.env.WSL_DISTRO_NAME || "Ubuntu";
  const tmp = mkdtempSync(join(tmpdir(), "drive-read-"));
  const tmpFile = join(tmp, "content.txt");
  const unc = `\\\\wsl.localhost\\${distro}${tmpFile.replace(/\//g, "\\")}`;

  const escapedSrc = winPath.replace(/'/g, "''");
  const ps = `
    $ErrorActionPreference = 'Stop'
    if (-not (Test-Path -LiteralPath '${escapedSrc}')) { exit 1 }
    Copy-Item -LiteralPath '${escapedSrc}' -Destination '${unc.replace(/'/g, "''")}' -Force
  `;

  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    return { ok: false, bridge: true };
  }

  try {
    const content = readFileSync(tmpFile, "utf8");
    rmSync(tmp, { recursive: true, force: true });
    return { ok: true, bridge: true, content };
  } catch {
    rmSync(tmp, { recursive: true, force: true });
    return { ok: false, bridge: true };
  }
}

/**
 * Try to write `content` (UTF-8 string) to `outPath` directly via Node fs.
 * Returns true on success, false on any failure (so callers can fall back to
 * the powershell bridge without throwing here). Creates parent directories
 * as needed.
 *
 * Skips the attempt entirely (returns `false` immediately) when not running
 * on Windows and `outPath` looks like a Windows drive path — see
 * `tryDirectRead`'s doc comment for why this guard matters: without it, a
 * backslash-style path silently writes to a bogus locally-named file instead
 * of failing over to the bridge.
 * @param {string} outPath
 * @param {string} content
 * @returns {boolean}
 */
export function tryDirectWrite(outPath, content) {
  if (process.platform !== "win32" && isWindowsDrivePath(outPath)) {
    return false;
  }
  try {
    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Write `content` (UTF-8 string) to a Windows drive-letter path `winPath` by
 * writing to a local temp file and invoking `powershell.exe Copy-Item` via
 * the `\\wsl.localhost\<distro>\...` UNC bridge. Returns true on success.
 *
 * The wsl.localhost distro name is read from `WSL_DISTRO_NAME` (set by WSL on
 * session start); if missing, falls back to `Ubuntu` which is the default.
 * On Windows native this function is not reached (direct write succeeds).
 * @param {string} winPath
 * @param {string} content
 * @param {boolean} skipIfExists — when true, do nothing if the file already
 *   exists (used for protected user-edit files like acceptance.md / prd.md).
 * @returns {boolean}
 */
export function writeViaPowershell(winPath, content, skipIfExists = false) {
  if (!existsSync(PS_PATH)) return false;

  const distro = process.env.WSL_DISTRO_NAME || "Ubuntu";
  const tmp = mkdtempSync(join(tmpdir(), "drive-write-"));
  const tmpFile = join(tmp, "content.txt");
  writeFileSync(tmpFile, content, "utf8");
  const unc = `\\\\wsl.localhost\\${distro}${tmpFile.replace(/\//g, "\\")}`;

  const guard = skipIfExists
    ? `if (Test-Path '${winPath.replace(/'/g, "''")}') { 'EXISTS'; exit }`
    : "";
  const ps = `
    $ErrorActionPreference = 'Stop'
    ${guard}
    $dst = '${winPath.replace(/'/g, "''")}'
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item -LiteralPath '${unc}' -Destination $dst -Force
    Test-Path $dst
  `;

  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    const out = String(result.stdout || "").trim();
    if (out === "EXISTS") return true; // protected file already present
    process.stderr.write(
      "drive-bridge: powershell bridge failed: " +
        (result.stderr || result.error?.message || "unknown error") +
        "\n"
    );
    return false;
  }
  return String(result.stdout).trim() === "True";
}

/**
 * Check whether a Windows drive-letter path exists via powershell.
 * @param {string} winPath
 * @returns {boolean}
 */
export function pathExistsViaPowershell(winPath) {
  if (!existsSync(PS_PATH)) return false;
  const ps = `Test-Path '${winPath.replace(/'/g, "''")}'`;
  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  return String(result.stdout || "").trim() === "True";
}

/**
 * List entry names (files + directories) directly under `dirPath` via
 * `Get-ChildItem -Name`. Returns [] on any failure (missing dir, no
 * powershell) — "no entries" is exactly the right fallback in that case.
 * @param {string} dirPath
 * @returns {string[]}
 */
export function listDirEntriesViaPowershell(dirPath) {
  if (!existsSync(PS_PATH)) return [];
  const escaped = dirPath.replace(/'/g, "''");
  // Get-ChildItem -Name writes filesystem entry names to the console using
  // Windows PowerShell 5.1's default console encoding (not UTF-8), which
  // garbles non-ASCII names (e.g. Japanese) once captured back through
  // Node's utf8-decoded stdout. Force UTF-8 output first so names round-trip
  // correctly — unlike the boolean-only helpers above, this one returns
  // arbitrary filesystem text, so it needs this.
  const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; if (Test-Path '${escaped}') { Get-ChildItem -Name '${escaped}' }`;
  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * List entries directly under `dirPath` with type info, trying direct Node
 * `readdirSync` first and falling back to the powershell bridge (with the
 * same UTF-8 output-encoding fix as `listDirEntriesViaPowershell`) for
 * Windows drive paths unreachable directly from WSL. Returns [] when
 * `dirPath` doesn't exist or listing otherwise fails. Used by `drive-fs.mjs`
 * `list`.
 * @param {string} dirPath
 * @returns {Array<{ name: string, isDirectory: boolean }>}
 */
export function listDirEntriesDetailed(dirPath) {
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(dirPath);

  if (onWindows || !looksWindows) {
    try {
      return readdirSync(dirPath, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
    } catch {
      return [];
    }
  }

  if (!existsSync(PS_PATH)) return [];
  const escaped = dirPath.replace(/'/g, "''");
  const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; if (Test-Path '${escaped}') { Get-ChildItem -LiteralPath '${escaped}' | ForEach-Object { $_.Name + '|||' + $_.PSIsContainer } }`;
  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.lastIndexOf("|||");
      const name = idx >= 0 ? line.slice(0, idx) : line;
      const isDirectory = idx >= 0 ? line.slice(idx + 3).trim() === "True" : false;
      return { name, isDirectory };
    });
}

/**
 * Create `dirPath` (and any missing parents), trying direct Node fs first
 * and falling back to `New-Item -ItemType Directory` via powershell for
 * Windows drive paths unreachable directly from WSL.
 * @param {string} dirPath
 * @returns {{ ok: boolean, bridge: boolean }}
 */
export function mkdirViaBridge(dirPath) {
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(dirPath);

  if (onWindows || !looksWindows) {
    try {
      mkdirSync(dirPath, { recursive: true });
      return { ok: true, bridge: false };
    } catch {
      // fall through to the bridge attempt below when it looks like a
      // Windows path; otherwise this is a real local failure.
    }
  }
  if (!looksWindows) return { ok: false, bridge: false };
  if (!existsSync(PS_PATH)) return { ok: false, bridge: true };

  const escaped = dirPath.replace(/'/g, "''");
  const ps = `if (-not (Test-Path '${escaped}')) { New-Item -ItemType Directory -Path '${escaped}' -Force | Out-Null }; Test-Path '${escaped}'`;
  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return { ok: false, bridge: true };
  return { ok: String(result.stdout).trim() === "True", bridge: true };
}

/**
 * Move/rename `fromPath` to `toPath` (single explicit target — no
 * wildcards), trying direct Node `renameSync` first and falling back to
 * `Move-Item` via powershell for Windows drive paths unreachable directly
 * from WSL. Creates the destination's parent directory if needed.
 * @param {string} fromPath
 * @param {string} toPath
 * @returns {{ ok: boolean, bridge: boolean }}
 */
export function moveViaBridge(fromPath, toPath) {
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(fromPath) || isWindowsDrivePath(toPath);

  if (onWindows || !looksWindows) {
    try {
      renameSync(fromPath, toPath);
      return { ok: true, bridge: false };
    } catch {
      // fall through to the bridge attempt below when it looks like a
      // Windows path; otherwise this is a real local failure.
    }
  }
  if (!looksWindows) return { ok: false, bridge: false };
  if (!existsSync(PS_PATH)) return { ok: false, bridge: true };

  const escFrom = fromPath.replace(/'/g, "''");
  const escTo = toPath.replace(/'/g, "''");
  const ps = `
    $ErrorActionPreference = 'Stop'
    $dst = '${escTo}'
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Move-Item -LiteralPath '${escFrom}' -Destination $dst -Force
    Test-Path $dst
  `;
  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return { ok: false, bridge: true };
  return { ok: String(result.stdout).trim() === "True", bridge: true };
}

/**
 * Delete exactly one file or directory (recursively) — a single explicit
 * path, never a pattern/wildcard/loop. Callers (`drive-fs.mjs`'s `delete`
 * subcommand) must resolve the exact target first (e.g. via `list`) and
 * confirm with the user before calling this; there is intentionally no bulk
 * variant, since Claude Code's auto-mode classifier blocks pattern-based
 * bulk destructive operations.
 * @param {string} targetPath
 * @returns {{ ok: boolean, bridge: boolean }}
 */
export function deleteViaBridge(targetPath) {
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(targetPath);

  if (onWindows || !looksWindows) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return { ok: true, bridge: false };
    } catch {
      // fall through to the bridge attempt below when it looks like a
      // Windows path; otherwise this is a real local failure.
    }
  }
  if (!looksWindows) return { ok: false, bridge: false };
  if (!existsSync(PS_PATH)) return { ok: false, bridge: true };

  const escaped = targetPath.replace(/'/g, "''");
  const ps = `if (Test-Path '${escaped}') { Remove-Item -LiteralPath '${escaped}' -Recurse -Force }; -not (Test-Path '${escaped}')`;
  const result = spawnSync(PS_PATH, ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return { ok: false, bridge: true };
  return { ok: String(result.stdout).trim() === "True", bridge: true };
}
