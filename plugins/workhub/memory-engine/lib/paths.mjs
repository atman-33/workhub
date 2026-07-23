// Shared path resolution for the workhub memory engine.
//
// The engine *source* lives inside the plugin (this directory). Its npm
// dependencies (node-sqlite3-wasm, @huggingface/transformers) and
// the embedding-model cache are installed once per machine into ENGINE_HOME
// by `cli.mjs setup`, so plugin updates never wipe them. The SQLite database
// lives inside the vault (`_ai/memory/memory.db`) and is gitignored there.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Bump when the dependency set or embedding model changes; `setup` re-runs
// the full install when the marker's version no longer matches.
export const ENGINE_VERSION = 2;

export const ENGINE_HOME = join(homedir(), ".workhub", "memory-engine");
export const MARKER_PATH = join(ENGINE_HOME, ".setup-version");
export const MODELS_DIR = join(ENGINE_HOME, "models");
export const LOCK_PATH = join(ENGINE_HOME, "embed.lock");
export const INJECT_STATE_PATH = join(ENGINE_HOME, "inject-state.json");
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
  try {
    const marker = JSON.parse(readFileSync(MARKER_PATH, "utf8"));
    return marker.version === ENGINE_VERSION ? marker : null;
  } catch {
    return null;
  }
}
