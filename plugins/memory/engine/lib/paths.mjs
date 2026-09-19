// Shared path resolution for the workhub memory engine.
//
// The engine *source* lives inside the plugin (this directory). Its npm
// dependencies (node-sqlite3-wasm, @huggingface/transformers) and
// the embedding-model cache are installed once per machine into ENGINE_HOME
// by `cli.mjs setup`, so plugin updates never wipe them. The SQLite database
// lives inside the vault (`_ai/memory/memory.db`) and is gitignored there.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

// Bump when the dependency set, the embedding model, or the *set of files*
// under this directory changes. `setup` short-circuits while the marker still
// matches, so the copy it installed under INSTALLED_ENGINE_DIR is otherwise
// never refreshed — and a copy missing a newly added module fails to load for
// every caller that uses it (the OpenCode plugin, a plain terminal).
// 3: added lib/capture.mjs (T-0366).
// 4: added lib/doctor.mjs, lib/note.mjs, lib/schema.mjs (T-0367, T-0368).
// 5: added lib/store.mjs, lib/brief.mjs, lib/checkpoint.mjs (T-0369).
// 6: added lib/reflexes.mjs (T-0370).
// 7: capture-json records capture health (T-0371). Not a new file, but the
//    OpenCode plugin runs the installed copy, so without a bump the fix
//    never reaches it.
// 8: T-0375 rewrote the reflex text and added the `notes` search; the
//    OpenCode plugin runs the installed copy, so it still showed the old
//    text. A version mismatch is no longer silent either (T-0385).
// 9: added lib/reflect.mjs; `inject` asks for memory-reflect on an OpenCode
//    session's first prompt (T-0386).
export const ENGINE_VERSION = 9;

export const ENGINE_HOME = join(homedir(), ".workhub", "memory-engine");
export const MARKER_PATH = join(ENGINE_HOME, ".setup-version");
export const MODELS_DIR = join(ENGINE_HOME, "models");
export const LOCK_PATH = join(ENGINE_HOME, "embed.lock");
export const INJECT_STATE_PATH = join(ENGINE_HOME, "inject-state.json");

/**
 * Engine home for this process.
 *
 * `WORKHUB_ENGINE_HOME` overrides it so a test can point capture state at a
 * temporary directory instead of the real install. Resolved per call rather
 * than at import time, because a test sets the variable after the module has
 * already been loaded.
 */
export function engineHome() {
  return process.env.WORKHUB_ENGINE_HOME ?? ENGINE_HOME;
}

/** Where `setup` puts the version-stable engine copy, under {@link engineHome}. */
export function installedEngineDir() {
  return join(engineHome(), "engine");
}

/** The embedding model cache, under {@link engineHome}. */
export function modelsDir() {
  return join(engineHome(), "models");
}

/** The setup marker, under {@link engineHome}. */
export function markerPath() {
  return join(engineHome(), ".setup-version");
}

// Capture health and the retry queue are machine-local: the queue holds
// transcript paths, which only mean anything on the machine that wrote them.
export function captureStatePath() {
  return join(engineHome(), "capture-state.json");
}

export function captureQueuePath() {
  return join(engineHome(), "capture-queue.jsonl");
}

// When `memory-reflect` last ran. Machine-local for the same reason: it is
// about this machine's database (T-0386).
export function reflectStatePath() {
  return join(engineHome(), "reflect-state.json");
}

// Sessions `cli.mjs inject` has already seen, so it can tell a session's first
// prompt from the rest. Only OpenCode needs it — Claude Code has SessionStart.
export function injectSeenPath() {
  return join(engineHome(), "inject-seen.json");
}
// Setup copies the engine source here so callers outside the Claude plugin
// (OpenCode plugin, plain terminals) have a version-stable CLI path that
// doesn't depend on the versioned plugin cache directory.
export const INSTALLED_ENGINE_DIR = join(ENGINE_HOME, "engine");

/** Resolve the workhub vault path (same order as the task skills). */
export function resolveVault() {
  if (process.env.WORKHUB_VAULT) return process.env.WORKHUB_VAULT;
  const cwd = process.cwd();
  if (existsSync(join(cwd, "tasks")) && existsSync(join(cwd, "_ai"))) return cwd;
  for (const dir of [
    join(homedir(), ".workhub"),
    process.env.APPDATA ? join(process.env.APPDATA, "workhub") : null,
  ]) {
    if (!dir) continue;
    try {
      const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      if (cfg.vault_path) return cfg.vault_path;
    } catch {
      // missing or unreadable config — try the next location
    }
  }
  return null;
}

/**
 * The vault a *hook* may act on: `resolveVault()`, but the configured vault
 * only counts while the session is running inside it.
 *
 * The plugin installs at user scope, so its hooks run in every session on the
 * machine. `resolveVault()` answers "which vault does this machine have",
 * which is the right question for the CLI and the wrong one for a hook: it
 * would capture a session in an unrelated repository into the vault memory
 * database. The cwd gate is the same one `hooks/lib.mjs` applies, duplicated
 * rather than imported because `setup` copies this engine out of the plugin
 * and it has to keep working from `ENGINE_HOME`.
 */
export function resolveVaultForHook() {
  const vault = resolveVault();
  if (!vault) return null;
  if (process.env.WORKHUB_VAULT) return vault;
  const cwd = resolve(process.cwd()).toLowerCase();
  const root = resolve(vault).toLowerCase();
  return cwd === root || cwd.startsWith(root + sep) ? vault : null;
}

export function dbPathForVault(vault) {
  return join(vault, "_ai", "memory", "memory.db");
}

/**
 * Per-agent enable switch from the workhub app settings
 * (`~/.workhub/config.json`). Missing config or field means enabled — the
 * feature defaults to on once set up.
 *
 * @param {"claude_code" | "opencode"} agent
 */
export function memoryEnabled(agent) {
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), ".workhub", "config.json"), "utf8"),
    );
    const value = cfg.settings?.[`memory_${agent}`];
    return value !== false;
  } catch {
    return true;
  }
}

/**
 * Read the setup marker. Returns the parsed marker object when the installed
 * engine matches ENGINE_VERSION, otherwise null (not set up / needs re-setup).
 */
export function readMarker() {
  const status = markerStatus();
  return status.state === "ok" ? status.marker : null;
}

/**
 * Why the engine is or is not usable, which {@link readMarker} flattens to
 * "usable or not".
 *
 * - `ok` — set up, and for this engine version.
 * - `missing` — never set up on this machine (or the marker is unreadable).
 *   Memory is simply not in use, so this stays quiet.
 * - `stale` — set up, but by a different plugin version. Every hook then
 *   stands down until `memory-setup` runs again, and nothing in a session
 *   says so. This is the state worth reporting (T-0385).
 *
 * @returns {{ state: "ok" | "missing" | "stale", marker: object | null, installed: number | null }}
 */
export function markerStatus() {
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath(), "utf8"));
  } catch {
    return { state: "missing", marker: null, installed: null };
  }
  if (!marker || typeof marker !== "object") {
    return { state: "missing", marker: null, installed: null };
  }
  const installed = typeof marker.version === "number" ? marker.version : null;
  if (installed === ENGINE_VERSION) return { state: "ok", marker, installed };
  return { state: "stale", marker, installed };
}

/**
 * The one line a session gets when the engine is `stale`: memory has stopped,
 * why, and the one command that restarts it.
 *
 * @param {number | null} installed the version the marker records
 */
export function staleEngineNotice(installed) {
  const from = installed === null ? "an unknown version" : `version ${installed}`;
  return (
    `[workhub-memory] Memory is paused on this machine: the memory plugin was updated ` +
    `(engine ${from} installed, ${ENGINE_VERSION} expected), so nothing is being recorded ` +
    `or recalled. Tell the user to run \`/memory-setup\` once to resume.`
  );
}
