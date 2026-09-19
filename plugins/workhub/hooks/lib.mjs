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
 * identity injected, its prompts answered out of vault memory, and its
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
 * The vault's `_ai/` working-data folder: `_ai/state/` if it exists, else
 * `_ai/memory/` if it exists (a vault not yet carried through the T-0390
 * rename), else `_ai/state/` — the folder every fresh write should land in.
 *
 * Transitional: `_ai/memory/` was renamed to `_ai/state/` in T-0390 because
 * the name collided with the unrelated `memory/` knowledge layer. Every
 * reader and writer of this folder goes through this one function so a vault
 * whose plugins updated before `vault-upgrade`'s migration ran keeps working
 * against its existing `_ai/memory/` data instead of silently starting a
 * second, empty folder beside it.
 *
 * @param {string} vault
 */
export function resolveAiStateDir(vault) {
  const state = join(vault, "_ai", "state");
  if (existsSync(state)) return state;
  const legacy = join(vault, "_ai", "memory");
  if (existsSync(legacy)) return legacy;
  return state;
}

/**
 * The always-loaded layer of the vault's memory: `<vault>/memory/identity/`,
 * holding `about-me.md` and `decision-policy.md`.
 *
 * It is read in full on every session, which is the whole reason it is capped
 * and kept separate from `memory/notes/` — those are reached by search. The
 * split is by how something gets into a session, not by what it is about.
 *
 * This used to be `<vault>/profile/`. The two were the same layer described
 * twice, and `memory/` does everything the old folder did with types, an
 * index and a health check on top (T-0374). No fallback: the move happens
 * once.
 */
export function resolveIdentityDir(vault) {
  return join(vault, "memory", "identity");
}

/** The owner's decision policy note, the file the identity hooks gate on. */
export function resolveDecisionPolicy(vault) {
  return join(resolveIdentityDir(vault), "decision-policy.md");
}

/**
 * Where the individual calls the owner has settled live: one typed note each
 * (`type: decision`) under `<vault>/memory/notes/`, found by search rather
 * than read whole. The policy holds the axes; these are the cases.
 */
export function resolveNotesDir(vault) {
  return join(vault, "memory", "notes");
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

/**
 * The vault path for the response-language reminder (T-0388): `WORKHUB_VAULT`,
 * else the app config's `settings.vault_path`. Deliberately **not** gated on
 * the cwd being inside the vault, unlike `resolveVault()` above — language is
 * a property of the person, not of the repository a session happens to be
 * working in, so the reminder has to reach every Claude Code session, vault
 * or not.
 */
function resolveVaultForLanguage() {
  if (process.env.WORKHUB_VAULT) return process.env.WORKHUB_VAULT;
  const cfg = readConfig();
  return cfg.settings?.vault_path ?? cfg.vault_path ?? null;
}

/**
 * Reads `<vault>/.workhub/settings.json`'s `settings` object, or `null` when
 * there is no vault, no file, or the file cannot be parsed.
 */
function readVaultSettings(vaultPath) {
  try {
    const doc = JSON.parse(readFileSync(join(vaultPath, ".workhub", "settings.json"), "utf8"));
    return doc && typeof doc.settings === "object" ? doc.settings : null;
  } catch {
    return null;
  }
}

/** Language code -> display name, for the injected reminder text. */
const LANGUAGE_NAMES = { ja: "Japanese", en: "English" };

/**
 * Maps a `language` setting code to its display name. An unrecognized code
 * (e.g. a future addition the hook has not learned yet) is used verbatim
 * rather than skipped, so the reminder still says *something* useful instead
 * of silently going quiet.
 */
export function languageName(code) {
  return LANGUAGE_NAMES[code] ?? code;
}

/**
 * Resolves the response-language reminder for this session: which language to
 * ask for, and whether the reminder should be injected at all. Both come from
 * the same source, in order:
 *
 * 1. The configured vault's `.workhub/settings.json` (`language` /
 *    `response_language_inject`), found via `WORKHUB_VAULT` or the app
 *    config's `vault_path` — ungated on cwd, see `resolveVaultForLanguage`.
 * 2. `~/.workhub/config.json` -> `settings.language`.
 * 3. `~/.workhub/config.json` -> `settings.task_language` (pre-T-0388 key, in
 *    case the app itself has not been updated yet on this machine).
 * 4. Otherwise `null` — inject nothing.
 *
 * `response_language_inject` is read from whichever of these levels supplied
 * the language, never mixed across levels, and missing means "on" (the
 * Rust-side default), matching how an optional vault-scoped bool behaves
 * everywhere else in this app.
 *
 * @returns {{ language: string, inject: boolean } | null}
 */
export function resolveResponseLanguage() {
  const vaultPath = resolveVaultForLanguage();
  if (vaultPath) {
    const vs = readVaultSettings(vaultPath);
    const language = vs?.language ?? vs?.task_language;
    if (language) {
      return { language, inject: vs.response_language_inject !== false };
    }
  }
  const settings = readConfig().settings ?? {};
  const language = settings.language ?? settings.task_language;
  if (language) {
    return { language, inject: settings.response_language_inject !== false };
  }
  return null;
}

/**
 * Does this tool call create a git worktree? (T-0389)
 *
 * Three ways in: a Bash `git worktree add` (global options such as
 * `-C <repo>` before the subcommand included), Claude Code's built-in
 * `EnterWorktree` tool, and an Agent launched with `isolation: "worktree"`.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} toolInput
 */
export function createsWorktree(toolName, toolInput = {}) {
  if (toolName === "EnterWorktree") return true;
  if (toolName === "Agent" || toolName === "Task") return toolInput?.isolation === "worktree";
  if (toolName !== "Bash") return false;
  const command = typeof toolInput?.command === "string" ? toolInput.command : "";
  return WORKTREE_ADD.test(command);
}

// `git`, any run of global options (`-C <path>`, `-c k=v`, `--long[=v]`), then
// `worktree add`. A quoted `-C` path may contain spaces.
const WORKTREE_ADD =
  /(?:^|[\s;&|(])git(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--[\w-]+(?:=\S+)?))*\s+worktree\s+add\b/;

/**
 * The task this session is working on and its `worktree:` flag, read from the
 * session's active-task marker (`<ai-state-dir>/sessions/<session_id>.json`,
 * which `task-start` writes — see {@link resolveAiStateDir}). `null` when the
 * session has no task, or the marker or the task file cannot be read.
 *
 * @param {string} vault
 * @param {string} sessionId
 * @returns {{ id: string, worktree: boolean } | null}
 */
export function activeTaskWorktree(vault, sessionId) {
  if (!vault || !sessionId) return null;
  try {
    const marker = JSON.parse(
      readFileSync(join(resolveAiStateDir(vault), "sessions", `${sessionId}.json`), "utf8"),
    );
    if (!marker?.file) return null;
    const text = readFileSync(join(vault, marker.file), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    const flag = /^worktree:\s*(\S+)/m.exec(fm)?.[1];
    return { id: marker.id ?? "", worktree: flag === "true" };
  } catch {
    return null;
  }
}

/**
 * The configured vault, whatever the cwd: `WORKHUB_VAULT`, else the app
 * config's `vault_path`. For hooks whose subject is the owner rather than the
 * vault — the language reminder, the worktree guard — and which therefore
 * have to act in target-repository sessions too.
 */
export function resolveConfiguredVault() {
  return resolveVaultForLanguage();
}
