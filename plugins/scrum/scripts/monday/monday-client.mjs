#!/usr/bin/env node
// @ts-check
/**
 * Shared monday.com GraphQL client used by the `scripts/monday/*.mjs` helpers.
 *
 * Reads the API token from the `MONDAY_TOKEN` environment variable only (never
 * from a file, so nothing secret can be committed by accident) and POSTs a
 * GraphQL query to `https://api.monday.com/v2`. Exposes:
 *
 *   - `requireToken()`  -> exits with a helpful message if `MONDAY_TOKEN` is
 *     missing/empty, matching the MCP launcher's failure mode.
 *   - `mondayFetch(query, variables)` -> resolves to the `data` object,
 *     throwing a readable Error on any network/GraphQL failure.
 *   - `parseBoardIdArg(argv, { allowConfigDefault })` -> reads a board id
 *     from argv or falls back to `.claude/scrum-context.json`, mirroring the
 *     SessionStart hook's resolution so the CLI scripts stay portable across
 *     opencode / CI / bash.
 *   - `resolveEpicFolder(groupTitle)` -> looks up the Google Drive Epic
 *     folder path configured for `groupTitle` in `.claude/scrum-context.json`'s
 *     `mondayEpics` map, so `save-all.mjs` / `init-task.mjs` don't need the
 *     full Drive path retyped as a CLI argument every time.
 *   - `normalizeEpicEntry(value)` / `resolveEpicConfig(groupTitle)` -> the
 *     shared `{drivePath, repo}` normalization for `mondayEpics` entries,
 *     which may be a legacy string (drivePath only) or an object
 *     (`{drivePath, repo: {url, epicBranch?, defaultBranch?}}`). Every script
 *     that needs repo info (`sync-repo.mjs`, the SessionStart hook) goes
 *     through this so the two accepted shapes never have to be re-parsed.
 *   - `resolveRepoWorkspacesRoot()` -> the local (non-Drive) root directory
 *     dedicated repo mirror clones live under, from `repoWorkspacesRoot` in
 *     `.claude/scrum-context.json`, defaulting to `~/.pm-repos`.
 *   - `printJson(value)` -> one compact JSON line to stdout (JSON Lines).
 *   - `readFileWithBridge(path)` / `pathExistsWithBridge(path)` -> the read
 *     counterparts to `writeFileWithBridge`, for scripts that need to read
 *     back a previously written Drive file (e.g. an existing item snapshot
 *     to detect whether it changed) or check for a legacy `.snapshots`
 *     folder, transparently using the powershell bridge on WSL when needed.
 *   - `fetchItemSnapshot(itemId)` / `fetchDocMarkdown(idArg)` /
 *     `fetchItemUpdates(itemId)` -> the read queries shared by `save-item`,
 *     `save-doc`, `save-updates`, and `save-all` so the bulk-fetch script
 *     does not reimplement single-item/doc/updates fetching.
 *   - `findLinkColumnByTitle(columns, title)` / `findFirstLinkColumn(columns)` /
 *     `setLinkColumn(boardId, itemId, columnId, url, text)` -> shared
 *     `link`-column lookup/write helpers used by `init-task.mjs` and
 *     `set-link.mjs`.
 *
 * Intentionally dependency-free (Node 18+ global `fetch`). No `npx`, no MCP,
 * no platform branching — the same script works on Windows native and WSL.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import {
  isWindowsDrivePath,
  tryDirectRead,
  tryDirectWrite,
  writeViaPowershell,
  readFileViaBridge,
  pathExistsViaPowershell,
  listDirEntriesViaPowershell,
} from "../drive/drive-bridge.mjs";

const MONDAY_API_URL = "https://api.monday.com/v2";
const TOKEN_HELP =
  "Get an API token from " +
  "https://developer.monday.com/api-reference/docs/authentication " +
  "and export it (e.g. in ~/.zshrc): export MONDAY_TOKEN=your_token_here";

/**
 * Read MONDAY_TOKEN from the environment. Exits with a helpful message if it
 * is missing or empty, matching the behaviour of the MCP launcher so the
 * failure mode is identical regardless of which entry point the user hits.
 * @returns {string}
 */
export function requireToken() {
  const token = process.env.MONDAY_TOKEN;
  if (!token || !token.trim()) {
    process.stderr.write(
      "monday: MONDAY_TOKEN environment variable is not set.\n" +
        TOKEN_HELP +
        "\n"
    );
    process.exit(1);
  }
  return token.trim();
}

/**
 * Execute a GraphQL request against the monday.com v2 API.
 *
 * On any failure (network, non-2xx, GraphQL `errors[]`/`error_message`)
 * throws an Error whose message already contains everything the caller
 * needs; scripts let it bubble to the top level and print it on stderr.
 * @param {string} query
 * @param {Record<string, unknown>=} variables
 * @returns {Promise<Record<string, unknown>>}
 */
export async function mondayFetch(query, variables) {
  const token = requireToken();

  /** @type {Response} */
  let res;
  try {
    res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "API-Version": "2024-01",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new Error(
      `monday: network request failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `monday: HTTP ${res.status} ${res.statusText}: ${text.trim()}`
    );
  }

  /** @type {{ data?: Record<string, unknown>, errors?: Array<{ message: string }>, error_message?: string }} */
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`monday: non-JSON response: ${text.trim()}`);
  }

  if (body.errors && body.errors.length > 0) {
    throw new Error(
      `monday: GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`
    );
  }
  if (body.error_message) {
    throw new Error(`monday: ${body.error_message}`);
  }
  if (!body.data) {
    throw new Error(`monday: empty response: ${text.trim()}`);
  }
  return body.data;
}

/**
 * Read all of stdin without blocking. Returns "" if there is no piped stdin
 * (interactive TTY) — callers fall back to env/cwd in that case.
 * @returns {string}
 */
export function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Resolve the project root the same way the scrum SessionStart hook does:
 * `CLAUDE_PROJECT_DIR` env first, then the `cwd` field of any JSON stdin
 * payload, finally `process.cwd()`. Kept here so the CLI scripts resolve the
 * `<scrum-context>` board id consistently when run from opencode / CI.
 * @param {string} stdinRaw
 * @returns {string}
 */
export function resolveProjectRoot(stdinRaw) {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  if (stdinRaw.trim()) {
    try {
      const payload = JSON.parse(stdinRaw);
      if (payload && typeof payload.cwd === "string" && payload.cwd) {
        return payload.cwd;
      }
    } catch {
      // ignore malformed stdin
    }
  }
  return process.cwd();
}

/**
 * Read `.claude/scrum-context.json` (if present) and return its
 * `mondayBoardId` field, or "" if not configured. Never throws — a missing
 * or malformed config just means "no default board id".
 * @param {string} projectRoot
 * @returns {string}
 */
function readConfigBoardId(projectRoot) {
  const configPath = join(projectRoot, ".claude", "scrum-context.json");
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return "";
  }
  try {
    const config = JSON.parse(raw);
    if (config && typeof config.mondayBoardId === "string") {
      return config.mondayBoardId.trim();
    }
  } catch {
    // malformed config: ignore, caller will prompt
  }
  return "";
}

/**
 * Read `.claude/scrum-context.json` (if present) and return its
 * `mondayEpics` map ({ "<groupName>": "<epicFolderPath> | {drivePath, repo}" }),
 * or `{}` if not configured/malformed. Never throws. Values are returned
 * as-is (string or object) — pass them through `normalizeEpicEntry` to get
 * the shared `{drivePath, repo}` shape.
 * @param {string} projectRoot
 * @returns {Record<string, unknown>}
 */
function readConfigMondayEpics(projectRoot) {
  const configPath = join(projectRoot, ".claude", "scrum-context.json");
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return {};
  }
  try {
    const config = JSON.parse(raw);
    if (config && typeof config.mondayEpics === "object" && config.mondayEpics) {
      return config.mondayEpics;
    }
  } catch {
    // malformed config: ignore, caller will prompt
  }
  return {};
}

/**
 * @typedef {{ url: string, epicBranch: string | null, defaultBranch: string | null }} EpicRepoConfig
 * @typedef {{ drivePath: string, repo: EpicRepoConfig | null }} NormalizedEpicEntry
 */

/**
 * Normalize one `mondayEpics[groupName]` entry to `{drivePath, repo}`.
 * Accepts the legacy string shape (`"<drivePath>"`, `repo: null`) or the
 * object shape (`{drivePath, repo: {url, epicBranch?, defaultBranch?}}`).
 * Never throws — anything unrecognized collapses to `{drivePath: "", repo:
 * null}` so callers can uniformly check `.drivePath` truthiness.
 * @param {unknown} value
 * @returns {NormalizedEpicEntry}
 */
export function normalizeEpicEntry(value) {
  if (typeof value === "string") {
    return { drivePath: value.trim(), repo: null };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    const drivePath =
      typeof obj.drivePath === "string" ? obj.drivePath.trim() : "";
    /** @type {EpicRepoConfig | null} */
    let repo = null;
    const repoRaw = obj.repo;
    if (
      repoRaw &&
      typeof repoRaw === "object" &&
      typeof (/** @type {any} */ (repoRaw).url) === "string" &&
      /** @type {any} */ (repoRaw).url.trim()
    ) {
      const r = /** @type {Record<string, unknown>} */ (repoRaw);
      repo = {
        url: /** @type {string} */ (r.url).trim(),
        epicBranch:
          typeof r.epicBranch === "string" && r.epicBranch.trim()
            ? r.epicBranch.trim()
            : null,
        defaultBranch:
          typeof r.defaultBranch === "string" && r.defaultBranch.trim()
            ? r.defaultBranch.trim()
            : null,
      };
    }
    return { drivePath, repo };
  }
  return { drivePath: "", repo: null };
}

/**
 * Resolve the normalized `{drivePath, repo}` Epic config for `groupTitle`
 * from `.claude/scrum-context.json`'s `mondayEpics` map, resolving the
 * project root the same way `parseBoardIdArg` does (`CLAUDE_PROJECT_DIR` ->
 * stdin `cwd` -> `process.cwd()`). Returns `{drivePath: "", repo: null}` when
 * not configured.
 * @param {string} groupTitle
 * @returns {Promise<NormalizedEpicEntry>}
 */
export async function resolveEpicConfig(groupTitle) {
  const stdinRaw = readStdin();
  const projectRoot = resolveProjectRoot(stdinRaw);
  const epics = readConfigMondayEpics(projectRoot);
  return normalizeEpicEntry(epics[groupTitle]);
}

/**
 * Resolve the Google Drive Epic folder path configured for `groupTitle` in
 * `.claude/scrum-context.json`'s `mondayEpics` map. Returns "" when not
 * configured — callers (`save-all.mjs`, `init-task.mjs`) fall back to
 * requiring an explicit CLI argument in that case. Thin wrapper over
 * `resolveEpicConfig` for callers that only need the path, not repo info.
 * @param {string} groupTitle
 * @returns {Promise<string>}
 */
export async function resolveEpicFolder(groupTitle) {
  const { drivePath } = await resolveEpicConfig(groupTitle);
  return drivePath;
}

/**
 * Resolve the local (non-Drive) root directory that dedicated repo mirror
 * clones live under, from `repoWorkspacesRoot` in
 * `.claude/scrum-context.json`, defaulting to `~/.pm-repos` when unset.
 * Deliberately local rather than under the Drive Epic folder — Drive sync
 * should never see a `.git` directory.
 * @returns {Promise<string>}
 */
export async function resolveRepoWorkspacesRoot() {
  const stdinRaw = readStdin();
  const projectRoot = resolveProjectRoot(stdinRaw);
  const configPath = join(projectRoot, ".claude", "scrum-context.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (
      config &&
      typeof config.repoWorkspacesRoot === "string" &&
      config.repoWorkspacesRoot.trim()
    ) {
      return config.repoWorkspacesRoot.trim();
    }
  } catch {
    // missing/malformed config: fall through to the default below
  }
  return join(homedir(), ".pm-repos");
}

/**
 * Parse a board id from argv, or fall back to `<scrum-context>` config when
 * `allowConfigDefault` is true. Exits with usage if neither is available.
 * @param {string[]} argv
 * @param {{ allowConfigDefault?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function parseBoardIdArg(argv, options) {
  const allowConfigDefault = options?.allowConfigDefault ?? true;
  const argBoardId = argv[2];
  if (argBoardId && /^\d+$/.test(argBoardId.trim())) {
    return argBoardId.trim();
  }
  if (allowConfigDefault) {
    const stdinRaw = readStdin();
    const projectRoot = resolveProjectRoot(stdinRaw);
    const configBoardId = readConfigBoardId(projectRoot);
    if (configBoardId) {
      return configBoardId;
    }
  }
  process.stderr.write(
    "monday: a board id is required.\n" +
      "Usage: <script> <boardId>\n" +
      "Either pass the board id as the first argument, or set " +
      "`mondayBoardId` in `.claude/scrum-context.json`.\n"
  );
  process.exit(2);
}

/**
 * Print `value` as a single line of compact JSON to stdout. JSON Lines keeps
 * the output both human-scannable and trivially parseable by callers (the
 * skill body, a CI wrapper, `jq`, …).
 * @param {unknown} value
 */
export function printJson(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

/**
 * Resolve an output path argument the same way save-item / save-doc /
 * save-updates do: explicit trailing slash → directory; existing path with
 * `.json`/`.md` extension → file; otherwise treat as a directory and append
 * `defaultName`.
 * @param {string} outArg
 * @param {string} defaultName
 * @returns {string}
 */
function resolveOutPath(outArg, defaultName) {
  if (!outArg) return defaultName;
  if (existsSync(outArg) && /[/\\]$/.test(outArg)) {
    return join(outArg, defaultName);
  }
  if (existsSync(outArg)) {
    return /\.(json|md)$/i.test(outArg) ? outArg : join(outArg, defaultName);
  }
  if (outArg.endsWith(sep) || outArg.endsWith("\\")) {
    return join(outArg, defaultName);
  }
  if (/\.(json|md)$/i.test(outArg)) return outArg;
  return join(outArg, defaultName);
}

/**
 * Write `content` to `outPath`, transparently using the powershell bridge
 * when the destination is a Windows drive-letter path on WSL and the drive
 * is not mounted at `/mnt/<drive>`. This is the single write entry point
 * shared by all snapshot scripts.
 *
 * `skipIfExists` protects user-edited files (acceptance.md, prd.md, task md):
 * when true and the file already exists, the write is silently skipped
 * (returns true with `skipped: true` in the result).
 * @param {string} outPath
 * @param {string} content
 * @param {{ skipIfExists?: boolean }} [options]
 * @returns {{ ok: boolean, skipped: boolean, bridge: boolean }}
 */
export function writeFileWithBridge(outPath, content, options) {
  const skipIfExists = options?.skipIfExists ?? false;
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(outPath);

  if (skipIfExists) {
    // Check existence via the same channel we'd write through, so WSL +
    // powershell-only paths are guarded too.
    if (onWindows || !looksWindows) {
      if (existsSync(outPath)) return { ok: true, skipped: true, bridge: false };
    } else if (pathExistsViaPowershell(outPath)) {
      return { ok: true, skipped: true, bridge: true };
    }
  }

  let written = false;
  let usedBridge = false;
  if (onWindows || !looksWindows) {
    written = tryDirectWrite(outPath, content);
  }
  if (!written && looksWindows) {
    written = writeViaPowershell(outPath, content, skipIfExists);
    usedBridge = true;
  }
  return { ok: written, skipped: false, bridge: usedBridge };
}

export { resolveOutPath };

/**
 * Read `path` as a UTF-8 string, using the same direct-fs-then-powershell-
 * bridge strategy as `writeFileWithBridge`'s write side. Returns `null` on
 * any failure (missing file, unreadable, bridge failure) rather than
 * throwing — callers that need "does an existing snapshot say X" checks
 * (e.g. `save-all.mjs`'s incremental diff, `sync-repo.mjs`'s previous
 * `repo-state.json`) can treat `null` as "no prior value".
 * @param {string} path
 * @returns {string | null}
 */
export function readFileWithBridge(path) {
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(path);

  if (onWindows || !looksWindows) {
    const direct = tryDirectRead(path);
    if (direct.ok) return /** @type {string} */ (direct.content);
  }
  if (looksWindows) {
    const bridged = readFileViaBridge(path);
    if (bridged.ok) return /** @type {string} */ (bridged.content);
  }
  return null;
}

/**
 * Check whether `path` exists, using the same direct-fs-then-powershell-
 * bridge strategy as `writeFileWithBridge`. Used by the `.pm` migration
 * guard (`save-all.mjs`, `generate-progress-report.mjs`) and
 * `migrate-epic-layout.mjs` to detect a legacy `.snapshots` folder / an
 * already-migrated `.pm` folder on a Drive path that may not be directly
 * mounted (WSL).
 * @param {string} path
 * @returns {boolean}
 */
export function pathExistsWithBridge(path) {
  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(path);
  if (onWindows || !looksWindows) {
    if (existsSync(path)) return true;
    if (!looksWindows) return false;
  }
  return pathExistsViaPowershell(path);
}

/**
 * Sanitize a monday item/doc name for use as a filesystem path segment:
 * strips characters illegal in Windows filenames (`< > : " / \ | ? *` and
 * control characters), collapses/trims whitespace, and caps length so paths
 * stay reasonable. Falls back to `"untitled"` when nothing usable remains.
 * @param {string} name
 * @returns {string}
 */
export function slugifyName(name) {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  const capped = cleaned.slice(0, 60).trim();
  return capped || "untitled";
}

/**
 * Resolve an existing directory/file entry inside `parentDir` whose name is
 * exactly `id`, or starts with `${id}-` (and, when `extension` is given, ends
 * with it) — so a slug baked in at creation time keeps being used even after
 * the monday item/subitem is later renamed (only the id has to stay
 * correct). Falls back to `join(parentDir, \`${id}-${fallbackSlug}${extension}\`)`
 * when no existing entry matches (including when `parentDir` doesn't exist
 * yet). Shared by `init-task.mjs` for `pbi/<id>-<name>/` and
 * `sub-tasks/<id>-<name>.md` — deliberately **not** used for `.snapshots/*`,
 * which stays id-only since it is fully overwritten on every `save-all.mjs`
 * run.
 * @param {string} parentDir
 * @param {string} id
 * @param {string} fallbackSlug
 * @param {string} [extension] e.g. `.md` — matched at the end of the entry name
 * @returns {string}
 */
export function resolveIdPrefixedEntry(
  parentDir,
  id,
  fallbackSlug,
  extension = ""
) {
  const escapedExt = extension.replace(/\./g, "\\.");
  const pattern = new RegExp(`^${id}(-.*)?${escapedExt}$`);

  const onWindows = process.platform === "win32";
  const looksWindows = isWindowsDrivePath(parentDir);

  /** @type {string[]} */
  let entries = [];
  if (onWindows || !looksWindows) {
    try {
      entries = readdirSync(parentDir);
    } catch {
      entries = [];
    }
  } else {
    entries = listDirEntriesViaPowershell(parentDir);
  }

  const match = entries.find((name) => pattern.test(name));
  if (match) return join(parentDir, match);
  return join(parentDir, `${id}-${fallbackSlug}${extension}`);
}

const ITEM_SNAPSHOT_QUERY = `
  query GetItem($itemId: ID!) {
    items(ids: [$itemId]) {
      id
      name
      group { id title }
      board { id name }
      column_values { id type text value }
    }
  }
`;

/**
 * Fetch one item and shape it into the snapshot payload used by
 * `save-item.mjs` and `save-all.mjs` ({id, name, group, board,
 * column_values}). Shared here so both scripts fetch/shape items identically.
 * @param {string} itemId
 * @returns {Promise<{ id: string, name: string, group: string, board: { id: string, name: string } | null, column_values: unknown[] }>}
 */
export async function fetchItemSnapshot(itemId) {
  const data =
    /** @type {{ items?: Array<{ id: string, name: string, group?: { id: string, title: string }, board?: { id: string, name: string }, column_values?: unknown[] }> }} */ (
      await mondayFetch(ITEM_SNAPSHOT_QUERY, { itemId })
    );
  const item = data.items && data.items[0];
  if (!item) {
    throw new Error(`monday: item ${itemId} not found or inaccessible`);
  }
  return {
    id: item.id,
    name: item.name,
    group: item.group ? item.group.title : "",
    board: item.board ? { id: item.board.id, name: item.board.name } : null,
    column_values: item.column_values || [],
  };
}

const DOC_BY_OBJECT_ID_QUERY = `
  query DocByObjectId($objectIds: [ID!]) {
    docs(object_ids: $objectIds) {
      id
      name
    }
  }
`;

const DOC_BY_ID_QUERY = `
  query DocById($ids: [ID!]) {
    docs(ids: $ids) {
      id
      name
    }
  }
`;

const DOC_BLOCKS_QUERY = `
  query DocBlocks($ids: [ID!]) {
    docs(ids: $ids) {
      id
      name
      blocks {
        id
        type
        content
      }
    }
  }
`;

/**
 * Resolve the monday-internal doc id + name from either a doc-column
 * `objectId` (the id embedded in `doc`-type column values / doc URLs) or a
 * doc id, by trying `object_ids` first and falling back to `ids`.
 * @param {string} idArg
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function resolveDoc(idArg) {
  const byObjectId =
    /** @type {{ docs?: Array<{ id: string, name: string }> }} */ (
      await mondayFetch(DOC_BY_OBJECT_ID_QUERY, { objectIds: [idArg] })
    );
  if (byObjectId.docs && byObjectId.docs[0]) return byObjectId.docs[0];

  const byId = /** @type {{ docs?: Array<{ id: string, name: string }> }} */ (
    await mondayFetch(DOC_BY_ID_QUERY, { ids: [idArg] })
  );
  if (byId.docs && byId.docs[0]) return byId.docs[0];

  throw new Error(
    `monday: doc "${idArg}" not found (tried object_ids and ids)`
  );
}

/**
 * Extract the plain text of a block's `content` JSON (a Quill-delta-like
 * `{ deltaFormat: [{ insert }] }` payload) by concatenating every `insert`
 * string op. Returns "" for empty/malformed content rather than throwing, so
 * one odd block doesn't fail the whole doc.
 * @param {string} content
 * @returns {string}
 */
function blockText(content) {
  if (!content) return "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  const ops =
    parsed && Array.isArray(parsed.deltaFormat) ? parsed.deltaFormat : null;
  if (!ops) return "";
  return ops
    .map((/** @type {any} */ op) =>
      op && typeof op.insert === "string" ? op.insert : ""
    )
    .join("")
    .replace(/\n+$/, "");
}

/**
 * Render one doc block as a line of Markdown based on its monday `type`.
 * Types not listed here (anything not yet seen in practice) fall back to
 * plain text, so unsupported blocks still contribute their content instead
 * of being silently dropped.
 * @param {{ type: string, content: string }} block
 * @returns {string}
 */
function blockToMarkdown(block) {
  const text = blockText(block.content);
  switch (block.type) {
    case "bulleted list":
      return `- ${text}`;
    case "numbered list":
      return `1. ${text}`;
    case "checkbox list":
      return `- [ ] ${text}`;
    case "quote":
      return `> ${text}`;
    case "divider":
      return "---";
    case "code":
      return "```\n" + text + "\n```";
    case "large heading":
    case "heading1":
      return `# ${text}`;
    case "medium heading":
    case "heading2":
      return `## ${text}`;
    case "small heading":
    case "heading3":
      return `### ${text}`;
    default:
      return text;
  }
}

/**
 * Fetch a monday doc's blocks (via `resolveDoc`) and render them as a single
 * Markdown document (`# <name>` heading followed by the rendered blocks).
 * Shared by `save-doc.mjs` and `save-all.mjs`.
 * @param {string} idArg doc id or doc-column `objectId`
 * @returns {Promise<{ id: string, name: string, markdown: string }>}
 */
export async function fetchDocMarkdown(idArg) {
  const doc = await resolveDoc(idArg);

  const data =
    /** @type {{ docs?: Array<{ id: string, name: string, blocks?: Array<{ id: string, type: string, content: string }> }> }} */ (
      await mondayFetch(DOC_BLOCKS_QUERY, { ids: [doc.id] })
    );
  const full = data.docs && data.docs[0];
  if (!full) {
    throw new Error(`monday: doc ${doc.id} not found or inaccessible`);
  }

  const body = (full.blocks || []).map((b) => blockToMarkdown(b)).join("\n\n");
  return {
    id: full.id,
    name: full.name,
    markdown: `# ${full.name}\n\n${body}\n`,
  };
}

const ITEM_UPDATES_QUERY = `
  query GetItemUpdates($itemId: ID!) {
    items(ids: [$itemId]) {
      id
      name
      updates {
        id
        body
        text_body
        created_at
        creator { id name }
        replies {
          id
          body
          text_body
          created_at
          creator { id name }
        }
      }
    }
  }
`;

/**
 * Fetch one item's updates (comment/activity feed), each with both `body`
 * (HTML) and `text_body` (plain text) plus replies. Shared by
 * `save-updates.mjs` and `save-all.mjs`.
 * @param {string} itemId
 * @returns {Promise<{ id: string, name: string, updates: unknown[] }>}
 */
export async function fetchItemUpdates(itemId) {
  const data =
    /** @type {{ items?: Array<{ id: string, name: string, updates?: unknown[] }> }} */ (
      await mondayFetch(ITEM_UPDATES_QUERY, { itemId })
    );
  const item = data.items && data.items[0];
  if (!item) {
    throw new Error(`monday: item ${itemId} not found or inaccessible`);
  }
  return { id: item.id, name: item.name, updates: item.updates || [] };
}

/**
 * @typedef {{ id: string, title: string, type: string }} BoardColumn
 */

const SET_LINK_MUTATION = `
  mutation SetLink($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
      id
    }
  }
`;

/**
 * Find a `link`-typed column by title (case-insensitive, trimmed). Returns
 * null when no such column exists on the board. Shared by `init-task.mjs`
 * and `set-link.mjs`.
 * @param {BoardColumn[]} columns
 * @param {string} title
 * @returns {string | null}
 */
export function findLinkColumnByTitle(columns, title) {
  const target = title.trim().toLowerCase();
  const col = columns.find(
    (c) => c.type === "link" && c.title.trim().toLowerCase() === target
  );
  return col ? col.id : null;
}

/**
 * Find the first `link`-typed column regardless of title (used on subitem
 * boards, which have exactly one `link` column in this convention).
 * @param {BoardColumn[]} columns
 * @returns {string | null}
 */
export function findFirstLinkColumn(columns) {
  const col = columns.find((c) => c.type === "link");
  return col ? col.id : null;
}

/**
 * Write `{ url, text }` to a `link`-typed column via monday's
 * `change_column_value` mutation.
 * @param {string} boardId
 * @param {string} itemId
 * @param {string} columnId
 * @param {string} url
 * @param {string} text
 */
export async function setLinkColumn(boardId, itemId, columnId, url, text) {
  await mondayFetch(SET_LINK_MUTATION, {
    boardId,
    itemId,
    columnId,
    value: JSON.stringify({ url, text }),
  });
}
