// Re-injects a short, user-configured "respond in <lang>" reminder into every
// model turn via experimental.chat.system.transform. Unlike the rule-injection
// plugins, this is not de-duped: it runs EVERY turn so the instruction can never
// drift out of context in long sessions. The text lives in
// response-language.json (sibling file) so it can be edited without touching
// plugin code; an mtime check reloads it on change.
//
// A small append-only log (inject-response-language.log) is written next to the
// plugin so users can visually confirm injection actually happened (tail -f).
//
// Scope: OpenCode-only. The Claude Code side does not need a mirror (per the
// user's decision) because AGENTS.md already instructs claude code natively.
import type { Plugin } from "@opencode-ai/plugin";
import { normalizePath, safeReadText } from "./lib/project-context-core";
import { appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface ResponseLanguageConfig {
  enabled?: boolean;
  lang?: string;
  reminderText?: string;
  note?: string;
}

const injectResponseLanguagePlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const pluginDir = join(workspaceRoot, ".opencode", "plugins");
  const configPath = join(pluginDir, "response-language.json");
  const logPath = join(pluginDir, "inject-response-language.log");

  let cachedConfig: ResponseLanguageConfig | null = null;
  let cachedMtimeMs = 0;

  const loadConfig = (): ResponseLanguageConfig | null => {
    let stat: { mtimeMs: number };
    try {
      stat = statSync(configPath);
    } catch {
      return null;
    }
    if (cachedConfig && stat.mtimeMs === cachedMtimeMs) {
      return cachedConfig;
    }
    const raw = safeReadText(configPath);
    if (!raw) {
      return null;
    }
    try {
      cachedConfig = JSON.parse(raw) as ResponseLanguageConfig;
      cachedMtimeMs = stat.mtimeMs;
    } catch {
      return null;
    }
    return cachedConfig;
  };

  const turnBySession = new Map<string, number>();

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }
      const config = loadConfig();
      if (!config || config.enabled === false) {
        return;
      }
      const reminderText = config.reminderText?.trim();
      if (!reminderText) {
        return;
      }

      const turn = (turnBySession.get(input.sessionID) ?? 0) + 1;
      turnBySession.set(input.sessionID, turn);

      const lines: string[] = ["<response-language-reminder>"];
      if (config.lang) {
        lines.push(`lang: ${config.lang}`);
      }
      lines.push(reminderText);
      if (config.note) {
        lines.push(config.note);
      }
      lines.push("</response-language-reminder>");
      output.system.push(lines.join("\n"));

      try {
        appendFileSync(
          logPath,
          `${new Date().toISOString()}\tsession=${input.sessionID}\tturn=${turn}\tlang=${config.lang ?? "?"}\n`,
        );
      } catch {
        // Logging is best-effort; never break the turn on a log failure.
      }
    },
  };
};

export default injectResponseLanguagePlugin;
export { injectResponseLanguagePlugin as server };