// @ts-check
/**
 * Shared core for the team-comms plugin: configuration, local state, the
 * on-disk format of a comms space, and the read/fold/publish primitives.
 *
 * Design document: ../../docs/design.html (Japanese original lives in the
 * workhub vault at projects/0010-workhub/backlog/B-015-team-comms-plugin/).
 *
 * The five invariants every writer here obeys (design §03):
 *   P1  files are immutable - created once, never edited, appended or deleted
 *   P2  exactly one agent may create any given path (the agent id is in it)
 *   P3  names cannot collide (UTC stamp + agent id + random suffix, no counters)
 *   P4  state changes are new event files, never edits to a shared file
 *   P5  publishing is atomic - write under a temp name, rename into place, and
 *       readers only ever consider names matching POST_FILE_RE
 *
 * Everything here is lenient: a malformed file is skipped rather than fatal, so
 * one bad post never takes down a whole scan.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const LOCAL_CONFIG_RELATIVE_PATH = ".claude/team-comms.json";
/**
 * Read state, focus and the thread cache are per machine, not per project, so
 * they live in the home directory. `TEAM_COMMS_STATE_DIR` relocates them - it
 * exists so tests (and only tests) can run several agents side by side on one
 * machine without sharing one another's read markers.
 */
export const STATE_DIR = process.env.TEAM_COMMS_STATE_DIR
  ? resolve(process.env.TEAM_COMMS_STATE_DIR)
  : join(homedir(), ".team-comms");
export const STATE_PATH = join(STATE_DIR, "state.json");
export const SCHEMA = "team-comms/post@1";

/** Post kinds understood by this version. Unknown kinds are kept but ignored. */
export const KINDS = [
  "open",
  "share",
  "reply",
  "opinion",
  "decision",
  "status",
  "join",
  "note",
];

/** Thread states, in the order they normally progress. */
export const STATES = ["open", "discussing", "decided", "closed"];

/**
 * The only filenames a reader accepts inside a thread folder.
 * `<seq>-<kind>-<agentId>-<utcStamp>-<rnd4>.md`
 * Anything else (a half-written temp file, a sync conflict copy, a stray note)
 * is invisible to the reader - which is what makes publishing safe (P5).
 */
export const POST_FILE_RE =
  /^(\d{3})-([a-z]+)-([a-z0-9][a-z0-9-]*)-(\d{8}T\d{6}Z)-([a-z0-9]{4})\.md$/;

/** `YYYYMMDD-<slug>-<rnd4>` */
export const THREAD_ID_RE = /^\d{8}-[a-z0-9][a-z0-9-]*-[a-z0-9]{4}$/;

/** Agent ids are lowercase ASCII: shared folders are often case-insensitive. */
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** Names a sync client gives a conflicting copy. Detected, never auto-moved. */
export const CONFLICT_NAME_RE =
  /(\(\d+\)\.[a-z0-9]+$)|(のコピー)|(\bconflicted copy\b)|(\bconflict\b.*\.md$)/i;

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Resolve the project root the way plugin hooks do: env -> cwd. */
export function resolveProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** `YYYYMMDDTHHMMSSZ` - no colons, because Windows filenames forbid them. */
export function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** `2026-09-12T13:45:00Z` - the frontmatter form, which is what ordering uses. */
export function utcIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `20260912T134500Z` -> `2026-09` (the month partition a thread lives in). */
export function monthOfStamp(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}`;
}

/** `20260912T134500Z` -> `2026-09-12T13:45:00Z` */
export function isoOfStamp(stamp) {
  return (
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` +
    `T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
  );
}

/** Four lowercase alphanumerics. Collision-proofing, not security. */
export function rnd4() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * ASCII-only slug for filenames. Japanese titles legitimately reduce to
 * nothing here - the readable title lives in the frontmatter, so we fall back
 * to a neutral word rather than inventing a transliteration.
 * @param {string} text
 */
export function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "thread";
}

/** @param {string} dir */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------
// configuration (machine-local)
// ---------------------------------------------------------------------

/**
 * Load `<projectRoot>/.claude/team-comms.json`. Returns null when absent or
 * unusable - callers turn that into "this project is not set up", never an
 * error, because an unconfigured project must stay silent.
 * @param {string} [projectRoot]
 */
export function loadConfig(projectRoot = resolveProjectRoot()) {
  const configPath = join(projectRoot, LOCAL_CONFIG_RELATIVE_PATH);
  const raw = readJson(configPath);
  if (!raw || typeof raw !== "object") return null;
  const commsRoot =
    typeof raw.commsRoot === "string" ? raw.commsRoot.trim() : "";
  const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : "";
  if (!commsRoot || !agentId) return null;
  return {
    commsRoot,
    agentId,
    person: typeof raw.person === "string" && raw.person.trim()
      ? raw.person.trim()
      : agentId,
    displayName:
      typeof raw.displayName === "string" && raw.displayName.trim()
        ? raw.displayName.trim()
        : agentId,
    agent:
      typeof raw.agent === "string" && raw.agent.trim()
        ? raw.agent.trim()
        : "unknown",
    configPath,
    projectRoot,
  };
}

/** @param {{ commsRoot: string }} config */
export function threadsRoot(config) {
  return join(config.commsRoot, "threads");
}

/** @param {{ commsRoot: string }} config @param {string} agentId */
export function mentionsDir(config, agentId) {
  return join(config.commsRoot, "mentions", agentId);
}

// ---------------------------------------------------------------------
// local state (focus, read markers, thread cache)
// ---------------------------------------------------------------------

/**
 * Read state is deliberately machine-local: putting it in the shared folder
 * would mean one write per person per session, and that write is the single
 * biggest conflict source the design exists to avoid (design §06).
 */
export function loadState() {
  const raw = readJson(STATE_PATH);
  const state =
    raw && typeof raw === "object" ? raw : { version: 1, focus: {}, read: {}, cache: {} };
  state.version = 1;
  state.focus = state.focus && typeof state.focus === "object" ? state.focus : {};
  state.read = state.read && typeof state.read === "object" ? state.read : {};
  state.cache = state.cache && typeof state.cache === "object" ? state.cache : {};
  return state;
}

/** @param {any} state */
export function saveState(state) {
  ensureDir(STATE_DIR);
  const tmp = `${STATE_PATH}.tmp-${rnd4()}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, STATE_PATH);
}

/**
 * Focus is per working directory, so two repositories can follow two different
 * threads at once. The key is the resolved path with separators normalised.
 * @param {string} projectRoot
 */
export function focusKey(projectRoot) {
  return resolve(projectRoot).replace(/\\/g, "/").toLowerCase();
}

/** @param {any} state @param {string} projectRoot */
export function getFocus(state, projectRoot) {
  const entry = state.focus[focusKey(projectRoot)];
  if (!entry || typeof entry !== "object") return null;
  return typeof entry.thread === "string" && entry.thread ? entry : null;
}

/** @param {any} state @param {string} projectRoot @param {string|null} threadId */
export function setFocus(state, projectRoot, threadId) {
  const key = focusKey(projectRoot);
  if (!threadId) delete state.focus[key];
  else state.focus[key] = { thread: threadId, since: utcIso() };
  return state;
}

/** Post ids this machine has already been shown, per thread. */
export function readIds(state, threadId) {
  const ids = state.read[threadId];
  return new Set(Array.isArray(ids) ? ids : []);
}

/** @param {any} state @param {string} threadId @param {string[]} ids */
export function markRead(state, threadId, ids) {
  const merged = readIds(state, threadId);
  for (const id of ids) merged.add(id);
  // Cap so the file cannot grow without bound on a very long thread.
  state.read[threadId] = [...merged].slice(-2000);
  return state;
}

// ---------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------

/**
 * Minimal YAML-frontmatter parser covering exactly the subset this schema
 * uses: flat `key: value`, inline `[a, b]` arrays and block `- item` lists.
 * Not a general YAML parser by design - a dependency-free plugin cannot carry
 * one, and the format is ours to keep simple.
 * @param {string} text
 * @returns {{ attrs: Record<string, any>, body: string }}
 */
export function parseFrontmatter(text) {
  /** @type {Record<string, any>} */
  const attrs = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { attrs, body: text };
  const lines = match[1].split(/\r?\n/);
  let currentListKey = null;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentListKey) {
      attrs[currentListKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (value === "") {
      // Either an empty scalar or the head of a block list; decide when the
      // next line arrives.
      attrs[key] = [];
      currentListKey = key;
      continue;
    }
    currentListKey = null;
    if (/^\[.*\]$/.test(value)) {
      attrs[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
      continue;
    }
    attrs[key] = unquote(value);
  }
  // An empty scalar that never got list items reads better as "".
  for (const [key, value] of Object.entries(attrs)) {
    if (Array.isArray(value) && value.length === 0 && key !== "mentions" && key !== "attachments") {
      attrs[key] = "";
    }
  }
  return { attrs, body: text.slice(match[0].length) };
}

/** @param {string} value */
function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

/** Extract the `## 要旨` / `## Summary` block, falling back to the first line. */
export function extractSummary(body) {
  const m = /^##\s*(?:要旨|Summary)\s*\r?\n([\s\S]*?)(?=\r?\n##\s|\s*$)/m.exec(body);
  const text = m ? m[1] : body;
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
}

// ---------------------------------------------------------------------
// reading a thread
// ---------------------------------------------------------------------

/** @param {string} dir */
function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Read one thread folder into a folded view. Files whose names do not match
 * POST_FILE_RE are ignored (P5) but reported as `oddities` so `scan` can flag
 * sync conflict copies.
 * @param {string} dir absolute path of the thread folder
 * @param {string} threadId
 */
export function readThread(dir, threadId) {
  const posts = [];
  const oddities = [];
  for (const entry of safeReaddir(dir)) {
    if (entry.isDirectory()) continue;
    const name = entry.name;
    const m = POST_FILE_RE.exec(name);
    if (!m) {
      if (name.endsWith(".md") && !name.startsWith(".tmp-")) {
        oddities.push({ name, conflict: CONFLICT_NAME_RE.test(name) });
      }
      continue;
    }
    const file = join(dir, name);
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable right now (streaming mode, mid-sync): skip
    }
    const { attrs, body } = parseFrontmatter(text);
    const stamp = m[4];
    posts.push({
      file,
      name,
      seq: m[1],
      kind: typeof attrs.kind === "string" && attrs.kind ? attrs.kind : m[2],
      from: typeof attrs.from === "string" && attrs.from ? attrs.from : m[3],
      person: typeof attrs.person === "string" && attrs.person ? attrs.person : (attrs.from || m[3]),
      id: typeof attrs.id === "string" && attrs.id ? attrs.id : `p-${stamp}-${m[3]}-${m[5]}`,
      created: typeof attrs.created === "string" && attrs.created ? attrs.created : isoOfStamp(stamp),
      stamp,
      schema: typeof attrs.schema === "string" ? attrs.schema : "",
      state: typeof attrs.state === "string" ? attrs.state : "",
      title: typeof attrs.title === "string" ? attrs.title : "",
      authorKind: typeof attrs.author_kind === "string" ? attrs.author_kind : "",
      agent: typeof attrs.agent === "string" ? attrs.agent : "",
      mentions: Array.isArray(attrs.mentions) ? attrs.mentions : [],
      attachments: Array.isArray(attrs.attachments) ? attrs.attachments : [],
      summary: extractSummary(body),
      body,
      known: !attrs.schema || String(attrs.schema).startsWith("team-comms/post@1"),
    });
  }
  posts.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1));
  return { id: threadId, path: dir, posts, oddities, ...foldThread(posts) };
}

/**
 * Derive the current view of a thread from its posts (P4). Nothing about a
 * thread is stored as mutable shared state - not its status, not its
 * participants, not its conclusion.
 * @param {ReturnType<typeof readThread>["posts"]} posts
 */
export function foldThread(posts) {
  const known = posts.filter((p) => p.known);
  const opening = known.find((p) => p.kind === "open");
  const title = opening?.title || opening?.summary || "(untitled)";

  let state = known.length > 1 ? "discussing" : "open";
  const statusPosts = known.filter((p) => p.kind === "status" && STATES.includes(p.state));
  if (statusPosts.length) state = statusPosts[statusPosts.length - 1].state;

  const decisions = known.filter((p) => p.kind === "decision");
  if (decisions.length && state !== "closed") state = "decided";

  const participants = [...new Set(known.map((p) => p.person).filter(Boolean))];
  const updated = known.length ? known[known.length - 1].created : "";
  const lastBy = known.length ? known[known.length - 1].person : "";

  return { title, state, decisions, participants, updated, lastBy, count: known.length };
}

/**
 * Which thread folders to look at.
 *
 * The month partition is keyed on the date a thread was *created*, so a
 * long-running discussion stays in an old folder while being the most active
 * thing in the space. Scanning "this month and last month" alone would
 * therefore drop new posts on exactly the threads that matter most, which is
 * why the cache and the focused thread are always included (design §05).
 *
 * @param {{ commsRoot: string }} config
 * @param {{ full?: boolean, cache?: Record<string, any>, extraThreadIds?: string[] }} [options]
 */
export function threadDirsToScan(config, options = {}) {
  const root = threadsRoot(config);
  const months = new Set();
  const now = new Date();
  months.add(monthOfStamp(utcStamp(now)));
  const prev = new Date(now.getTime());
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  months.add(monthOfStamp(utcStamp(prev)));

  /** @type {Map<string, string>} threadId -> absolute path */
  const found = new Map();

  const monthDirs = options.full
    ? safeReaddir(root).filter((e) => e.isDirectory()).map((e) => e.name)
    : [...months];

  for (const month of monthDirs) {
    for (const entry of safeReaddir(join(root, month))) {
      if (!entry.isDirectory() || !THREAD_ID_RE.test(entry.name)) continue;
      found.set(entry.name, join(root, month, entry.name));
    }
  }

  // Always include cached threads that are still alive, wherever they live.
  for (const [id, meta] of Object.entries(options.cache ?? {})) {
    if (found.has(id)) continue;
    if (meta?.state === "closed") continue;
    if (typeof meta?.path === "string" && existsSync(meta.path)) found.set(id, meta.path);
  }
  // ...and anything the caller insists on (the focused thread).
  for (const id of options.extraThreadIds ?? []) {
    if (found.has(id)) continue;
    const dir = findThreadDir(config, id);
    if (dir) found.set(id, dir);
  }
  return found;
}

/**
 * Locate one thread by id, month folder unknown. Tries the month encoded in
 * the id first (threads are usually created in the month they are named for),
 * then falls back to a full sweep.
 * @param {{ commsRoot: string }} config
 * @param {string} threadId
 */
export function findThreadDir(config, threadId) {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const root = threadsRoot(config);
  const guess = join(root, `${threadId.slice(0, 4)}-${threadId.slice(4, 6)}`, threadId);
  if (existsSync(guess)) return guess;
  for (const entry of safeReaddir(root)) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name, threadId);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Scan the space and return folded threads, newest activity first.
 * @param {{ commsRoot: string }} config
 * @param {{ full?: boolean, cache?: Record<string, any>, extraThreadIds?: string[] }} [options]
 */
export function scanThreads(config, options = {}) {
  const dirs = threadDirsToScan(config, options);
  const threads = [];
  for (const [id, dir] of dirs) threads.push(readThread(dir, id));
  threads.sort((a, b) => (a.updated > b.updated ? -1 : a.updated < b.updated ? 1 : 0));
  return threads;
}

/** Conflict copies and other stray files anywhere in the space. */
export function collectOddities(threads, config) {
  const items = [];
  for (const thread of threads) {
    for (const odd of thread.oddities) {
      items.push({ thread: thread.id, name: odd.name, conflict: odd.conflict, dir: thread.path });
    }
  }
  const quarantine = join(config.commsRoot, "_quarantine");
  return { items, quarantine };
}

// ---------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------

/**
 * Publish one file atomically (P5): write it under a name no reader accepts,
 * then rename it into place inside the same directory. The rename is atomic on
 * every filesystem this runs on, so a reader never observes a partial file -
 * and even mid-write the temp name is invisible because it fails POST_FILE_RE.
 * @param {string} dir
 * @param {string} finalName
 * @param {string} content
 */
export function publishFile(dir, finalName, content) {
  ensureDir(dir);
  const tmp = join(dir, `.tmp-${rnd4()}${rnd4()}`);
  writeFileSync(tmp, content, "utf8");
  const dest = join(dir, finalName);
  renameSync(tmp, dest);
  return dest;
}

/** Copy a local file into a post's attachment folder, atomically. */
export function publishAttachment(attachDir, name, sourcePath) {
  const content = readFileSync(sourcePath);
  ensureDir(attachDir);
  const tmp = join(attachDir, `.tmp-${rnd4()}${rnd4()}`);
  writeFileSync(tmp, content);
  const dest = join(attachDir, name);
  renameSync(tmp, dest);
  return dest;
}

/**
 * The sequence prefix is a readability hint, never an identity: two machines
 * posting at the same time legitimately produce the same number (design §03).
 * @param {number} existingCount
 */
export function seqPrefix(existingCount) {
  return String(Math.min(990, existingCount * 10)).padStart(3, "0");
}

/**
 * Compose a post file. Returns `{ name, content, id }` - the caller publishes
 * it, so the same function serves both the CLI and any test.
 * @param {{
 *   threadId: string, kind: string, config: any, summary: string, body?: string,
 *   title?: string, mentions?: string[], attachments?: string[],
 *   inReplyTo?: string, state?: string, authorKind?: string, existingCount: number,
 *   date?: Date,
 * }} input
 */
export function composePost(input) {
  const date = input.date ?? new Date();
  const stamp = utcStamp(date);
  const suffix = rnd4();
  const kind = input.kind;
  const agentId = input.config.agentId;
  const name = `${seqPrefix(input.existingCount)}-${kind}-${agentId}-${stamp}-${suffix}.md`;
  const id = `p-${stamp}-${agentId}-${suffix}`;

  const front = [
    "---",
    `schema: ${SCHEMA}`,
    `id: ${id}`,
    `thread: ${input.threadId}`,
    `kind: ${kind}`,
    `from: ${agentId}`,
    `person: ${input.config.person}`,
  ];
  if (input.title) front.push(`title: ${input.title}`);
  if (input.state) front.push(`state: ${input.state}`);
  front.push(`mentions: [${(input.mentions ?? []).join(", ")}]`);
  if (input.inReplyTo) front.push(`in_reply_to: ${input.inReplyTo}`);
  front.push(`created: ${utcIso(date)}`);
  front.push(`author_kind: ${input.authorKind || "ai"}`);
  front.push(`agent: ${input.config.agent}`);
  if (input.attachments?.length) {
    front.push("attachments:");
    for (const a of input.attachments) front.push(`  - ${a}`);
  }
  front.push("---", "");

  const sections = [`## 要旨`, input.summary.trim(), ""];
  if (input.body && input.body.trim()) {
    sections.push("## 本文", input.body.trim(), "");
  }
  return {
    name,
    id,
    summary: input.summary.trim(),
    content: `${front.join("\n")}\n${sections.join("\n")}`,
  };
}

/** The mention pointer: a few lines, never a copy of the post (design §05). */
export function composeMention(post, threadId, config, date = new Date()) {
  const stamp = utcStamp(date);
  const name = `${stamp}-${config.agentId}-${rnd4()}.md`;
  const content = [
    "---",
    "schema: team-comms/mention@1",
    `thread: ${threadId}`,
    `post: ${post.id}`,
    `from: ${config.agentId}`,
    `created: ${utcIso(date)}`,
    "---",
    "",
    String(post.summary ?? "").trim(),
    "",
  ].join("\n");
  return { name, content };
}

/** Mentions addressed to this agent that it has not seen yet. */
export function unreadMentions(config, state) {
  const dir = mentionsDir(config, config.agentId);
  const seen = readIds(state, "_mentions");
  const items = [];
  for (const entry of safeReaddir(dir)) {
    if (entry.isFile() === false || !entry.name.endsWith(".md")) continue;
    let text = "";
    try {
      text = readFileSync(join(dir, entry.name), "utf8");
    } catch {
      continue;
    }
    const { attrs, body } = parseFrontmatter(text);
    const key = typeof attrs.post === "string" ? attrs.post : entry.name;
    if (seen.has(key)) continue;
    items.push({
      key,
      file: join(dir, entry.name),
      thread: typeof attrs.thread === "string" ? attrs.thread : "",
      from: typeof attrs.from === "string" ? attrs.from : "",
      created: typeof attrs.created === "string" ? attrs.created : "",
      summary: body.trim().split(/\r?\n/).filter(Boolean)[0] ?? "",
    });
  }
  items.sort((a, b) => (a.created < b.created ? -1 : 1));
  return items;
}

/** Posts of a thread this machine has not been shown yet, excluding its own. */
export function unreadPosts(thread, state, agentId) {
  const seen = readIds(state, thread.id);
  return thread.posts.filter((p) => p.known && p.from !== agentId && !seen.has(p.id));
}

/** Refresh the local thread cache used to keep scanning cheap. */
export function updateCache(state, threads) {
  for (const thread of threads) {
    state.cache[thread.id] = {
      path: thread.path,
      title: thread.title,
      state: thread.state,
      updated: thread.updated,
      count: thread.count,
    };
  }
  return state;
}

/** Delete a file if it exists; used only for this agent's own probe files. */
export function removeQuietly(path) {
  try {
    rmSync(path, { force: true });
  } catch {
    // best effort
  }
}

/** True when `path` exists and is a directory. */
export function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
