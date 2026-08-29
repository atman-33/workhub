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
 * The owner's profile folder: `<vault>/profile/`, holding `about-me.md` and
 * `decision-policy.md`. It sits at the vault root rather than under
 * `knowledge/` because hooks, skills and the secretary agent all read it —
 * it is operational, not reference material.
 */
export function resolveProfileDir(vault) {
  return join(vault, "profile");
}

/** The owner's decision policy note, the file the profile hooks gate on. */
export function resolveDecisionPolicy(vault) {
  return join(resolveProfileDir(vault), "decision-policy.md");
}

/**
 * Secretary agent switch from the workhub app settings. Consulting the
 * secretary costs tokens (it is a subagent), so it is off by default and the
 * user turns it on in ⚙ Settings. Missing config or field means disabled —
 * the app stores the same default, and a hook that assumed the opposite would
 * run the secretary behind a Settings toggle that reads "off".
 */
export function secretaryEnabled() {
  return readConfig().settings?.secretary_enabled === true;
}

/** Read the hook payload from stdin as JSON. */
export function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}
