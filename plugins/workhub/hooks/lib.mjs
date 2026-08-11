import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read the workhub app config (`~/.workhub/config.json`, with the pre-0.49
 * `%APPDATA%\workhub\config.json` as a fallback). Returns `{}` when it is
 * missing or unreadable — hooks must never fail because of config.
 */
export function readConfig() {
  for (const dir of [
    join(homedir(), ".workhub"),
    process.env.APPDATA ? join(process.env.APPDATA, "workhub") : null,
  ]) {
    if (!dir) continue;
    try {
      return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    } catch {
      // missing or unreadable config — try the next location
    }
  }
  return {};
}

/** Resolve the workhub vault path: WORKHUB_VAULT env var, cwd, then config. */
export function resolveVault() {
  if (process.env.WORKHUB_VAULT) return process.env.WORKHUB_VAULT;
  const cwd = process.cwd();
  if (existsSync(join(cwd, "tasks")) && existsSync(join(cwd, "_ai"))) return cwd;
  const cfg = readConfig();
  return cfg.settings?.vault_path ?? cfg.vault_path ?? null;
}

/**
 * Secretary agent switch from the workhub app settings. Consulting the
 * secretary costs tokens (it is a subagent), so the user can turn the whole
 * mechanism off in ⚙ Settings. Missing config or field means enabled.
 */
export function secretaryEnabled() {
  return readConfig().settings?.secretary_enabled !== false;
}

/** Read the hook payload from stdin as JSON. */
export function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}
