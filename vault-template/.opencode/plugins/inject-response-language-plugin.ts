// Re-injects a short "reply in <lang>" reminder into every model turn via
// experimental.chat.system.transform. Unlike the rule-injection plugins, this
// is not de-duped: it runs EVERY turn so the instruction can never drift out
// of context in long sessions.
//
// Settings come from the workhub app, with the same precedence the Claude
// Code side uses (plugins/workhub/hooks/response-language.mjs, added
// alongside this rewrite in T-0388):
//
//   1. The configured vault's `.workhub/settings.json` (`language` /
//      `response_language_inject`) — vault resolved the same way
//      secretary-plugin.ts does: WORKHUB_VAULT, else ctx.directory when it is
//      itself a vault, else the app config's `vault_path`.
//   2. `~/.workhub/config.json` -> `settings.language`.
//   3. `~/.workhub/config.json` -> `settings.task_language` (pre-T-0388 key,
//      in case the app itself has not been updated yet).
//   4. Otherwise inject nothing.
//
// `response_language_inject` is read from whichever of those levels supplied
// the language, never mixed across levels; missing means "on", matching the
// Rust-side default for the vault-scoped bool.
//
// A small append-only log (.opencode/plugins/logs/inject-response-language.log)
// is written so users can visually confirm injection actually happened (tail -f).
//
// Scope: previously Claude-Code-side was said not to need a mirror, because
// AGENTS.md instructed Claude Code natively. That reasoning did not hold up in
// practice — static instructions alone were not enough to stop a session
// drifting into English mid-way — so Claude Code now also injects, via the
// hook above. This file's job is unchanged: do the same for OpenCode, reading
// straight from the settings files rather than from an intermediate
// response-language.json (that file is retired by this rewrite).
import type { Plugin } from "@opencode-ai/plugin";
import { normalizePath } from "./lib/project-context-core.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Language code -> display name, for the injected reminder text. */
const LANGUAGE_NAMES: Record<string, string> = { ja: "Japanese", en: "English" };

/**
 * Maps a `language` setting code to its display name. An unrecognized code is
 * used verbatim rather than skipped, matching the Claude Code hook's choice —
 * the reminder should say *something* useful rather than silently go quiet.
 */
function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function readJson(filePath: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readAppConfig(): Record<string, any> {
  for (const dir of [
    join(homedir(), ".workhub"),
    process.env.APPDATA ? join(process.env.APPDATA, "workhub") : null,
  ]) {
    if (!dir) continue;
    const cfg = readJson(join(dir, "config.json"));
    if (cfg) return cfg;
  }
  return {};
}

/**
 * Same shape as `secretary-plugin.ts`'s `resolveVault`: `WORKHUB_VAULT`, else
 * `workspaceRoot` when it is itself a vault, else the app config's
 * `vault_path`. Not gated on the session actually working inside the vault —
 * language is a property of the person, not of whichever directory OpenCode
 * happens to be running in.
 */
function resolveVault(workspaceRoot: string): string | null {
  if (process.env.WORKHUB_VAULT) return process.env.WORKHUB_VAULT;
  if (existsSync(join(workspaceRoot, "tasks")) && existsSync(join(workspaceRoot, "_ai"))) {
    return workspaceRoot;
  }
  const cfg = readAppConfig();
  return cfg.settings?.vault_path ?? cfg.vault_path ?? null;
}

function readVaultSettings(vault: string): Record<string, any> | null {
  const doc = readJson(join(vault, ".workhub", "settings.json"));
  return doc && typeof doc.settings === "object" ? doc.settings : null;
}

interface ResolvedLanguage {
  language: string;
  inject: boolean;
}

/** The response-language precedence described in the header comment above. */
function resolveResponseLanguage(workspaceRoot: string): ResolvedLanguage | null {
  const vault = resolveVault(workspaceRoot);
  if (vault) {
    const vs = readVaultSettings(vault);
    const language = vs?.language ?? vs?.task_language;
    if (language) {
      return { language, inject: vs?.response_language_inject !== false };
    }
  }
  const settings = readAppConfig().settings ?? {};
  const language = settings.language ?? settings.task_language;
  if (language) {
    return { language, inject: settings.response_language_inject !== false };
  }
  return null;
}

const injectResponseLanguagePlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const logDir = join(workspaceRoot, ".opencode", "plugins", "logs");
  const logPath = join(logDir, "inject-response-language.log");

  const turnBySession = new Map<string, number>();

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }
      const resolved = resolveResponseLanguage(workspaceRoot);
      if (!resolved || !resolved.inject) {
        return;
      }

      const turn = (turnBySession.get(input.sessionID) ?? 0) + 1;
      turnBySession.set(input.sessionID, turn);

      const name = languageName(resolved.language);
      output.system.push(
        `<response-language>Reply to the user in ${name} — every message, short or long. Code, comments, commit messages and repository documents follow their own rules.</response-language>`,
      );

      try {
        mkdirSync(logDir, { recursive: true });
        appendFileSync(
          logPath,
          `${new Date().toISOString()}\tsession=${input.sessionID}\tturn=${turn}\tlang=${resolved.language}\n`,
        );
      } catch {
        // Logging is best-effort; never break the turn on a log failure.
      }
    },
  };
};

export default injectResponseLanguagePlugin;
export { injectResponseLanguagePlugin as server };
