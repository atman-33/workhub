import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

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

/**
 * Is `dir` the vault root, or somewhere inside it? Compared case-insensitively
 * because these hooks run on Windows, where the path the app stored and the
 * cwd Claude Code reports routinely differ in drive-letter or folder casing.
 *
 * @param {string} dir
 * @param {string} root
 */
function isWithin(dir, root) {
  const a = resolve(dir).toLowerCase();
  const b = resolve(root).toLowerCase();
  return a === b || a.startsWith(b + sep);
}

/**
 * Resolve the workhub vault for a hook: `WORKHUB_VAULT`, else the cwd when it
 * is itself a vault, else the vault the app has configured — but that last one
 * only while the session is actually running inside it.
 *
 * That cwd gate is what makes this plugin safe to install at user scope. The
 * app config alone resolves a vault from any directory on the machine, so
 * without the gate every session in every repository would get the owner
 * profile injected, its prompts answered out of vault memory, and its
 * transcript captured into the vault memory database. Outside the vault the
 * hooks now no-op exactly as they already do on a machine that has no vault.
 *
 * A vault recognised from the cwd itself is still honoured without consulting
 * the config, so a second, unregistered vault keeps working. This is also why
 * the check is a subtree test rather than an equality one: a session started in
 * `<vault>/projects/foo` is in the vault, and used to fall through to the
 * config by accident.
 */
export function resolveVault() {
  if (process.env.WORKHUB_VAULT) return process.env.WORKHUB_VAULT;
  const cwd = process.cwd();
  if (existsSync(join(cwd, "tasks")) && existsSync(join(cwd, "_ai"))) return cwd;
  const cfg = readConfig();
  const configured = cfg.settings?.vault_path ?? cfg.vault_path ?? null;
  if (!configured) return null;
  return isWithin(cwd, configured) ? configured : null;
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
 * The owner's decision log: the individual calls they have settled. It is the
 * long tail of the policy, kept in its own file so the policy stays short
 * enough to be read in full on every question — this one is only ever grepped.
 */
export function resolveDecisionLog(vault) {
  return join(resolveProfileDir(vault), "decision-log.md");
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
