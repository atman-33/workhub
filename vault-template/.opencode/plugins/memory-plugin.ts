// OpenCode adapter for the workhub long-term memory engine (T-0060).
//
// Mirrors the Claude Code hooks shipped in the workhub plugin
// (plugins/workhub/hooks/memory-capture.mjs / memory-inject.mjs) — keep the
// two sides behaviorally aligned:
//   - inject: on each user message, run the engine's `inject` command and
//     prepend the returned context block (time summary + reminder on the
//     session's first prompt, relevance-gated related memories every prompt).
//   - capture: on session.idle, fetch the session's messages and hand them
//     to the engine's `capture-json` command (pairing/noise filtering and
//     background embedding live engine-side).
//
// The engine itself is NOT bundled here (no runtime npm deps allowed): setup
// (`/memory-setup`) installs a version-stable copy under
// `~/.workhub/memory-engine/engine/`, and this plugin shells out to its CLI
// with `node`. Everything no-ops silently until that setup has run, and the
// whole feature can be turned off for OpenCode via the workhub app setting
// `memory_opencode` (~/.workhub/config.json).
import type { Plugin } from "@opencode-ai/plugin";
import { makeEarlyPartId, normalizePath, safeReadText } from "./lib/project-context-core.ts";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENGINE_HOME = join(homedir(), ".workhub", "memory-engine");
const ENGINE_CLI = join(ENGINE_HOME, "engine", "cli.mjs");
const MARKER_PATH = join(ENGINE_HOME, ".setup-version");
// Vector search loads an ONNX model (~2.5 s); leave generous headroom but
// never let a wedged engine process hang the chat or the idle event.
const ENGINE_TIMEOUT_MS = 30_000;

function memoryEnabledForOpencode(): boolean {
  const raw = safeReadText(join(homedir(), ".workhub", "config.json"));
  if (!raw) return true;
  try {
    const cfg = JSON.parse(raw) as { settings?: { memory_opencode?: boolean } };
    return cfg.settings?.memory_opencode !== false;
  } catch {
    return true;
  }
}

function engineReady(): boolean {
  return existsSync(ENGINE_CLI) && existsSync(MARKER_PATH) && memoryEnabledForOpencode();
}

/**
 * Append a line to `.opencode/plugins/logs/memory.log`.
 *
 * The engine's diagnostics used to go to a discarded stderr, so an OpenCode
 * session that never once managed to record a memory left no trace at all —
 * which is how the gap found in T-0366 stayed invisible. Best-effort: a log
 * that cannot be written must not break the chat.
 */
function logMemory(cwd: string, line: string): void {
  try {
    const dir = join(cwd, ".opencode", "plugins", "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "memory.log"), `${new Date().toISOString()} ${line}
`);
  } catch {
    // nothing else to fall back to
  }
}

/** Run an engine CLI command with a JSON payload on stdin; returns stdout. */
function runEngine(command: string, payload: unknown, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const child = spawn(process.execPath, [ENGINE_CLI, command], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        logMemory(cwd, `${command}: timed out after ${ENGINE_TIMEOUT_MS}ms`);
        finish("");
      }, ENGINE_TIMEOUT_MS);
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString("utf8");
      });
      child.stderr.on("data", (d: Buffer) => {
        err += d.toString("utf8");
      });
      child.on("error", (e: Error) => {
        clearTimeout(timer);
        logMemory(cwd, `${command}: spawn failed — ${e.message}`);
        finish("");
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0 || err.trim()) {
          logMemory(cwd, `${command}: exit ${code}${err.trim() ? ` — ${err.trim()}` : ""}`);
        }
        finish(out.trim());
      });
      child.stdin.end(JSON.stringify(payload));
    } catch (e) {
      logMemory(cwd, `${command}: ${(e as Error).message}`);
      finish("");
    }
  });
}

interface MessageEntry {
  info?: { role?: string; time?: { created?: number } };
  parts?: { type?: string; text?: string; synthetic?: boolean }[];
}

function toSimpleMessages(entries: MessageEntry[]) {
  return entries
    .map((entry) => {
      const role = entry.info?.role ?? "";
      const text = (entry.parts ?? [])
        .filter((p) => p.type === "text" && p.text && !p.synthetic)
        .map((p) => p.text as string)
        .join("\n")
        .trim();
      const created = entry.info?.time?.created;
      const timestamp = typeof created === "number" ? new Date(created).toISOString() : "";
      return { role, text, timestamp };
    })
    .filter((m) => m.role === "user" || m.role === "assistant");
}

const memoryPlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  // Session ids confirmed as sub-agent (or confirmed main) sessions.
  const sessionKind = new Map<string, "main" | "child">();
  const capturedAt = new Map<string, number>();

  const isChildSession = async (sessionID: string): Promise<boolean> => {
    const known = sessionKind.get(sessionID);
    if (known) return known === "child";
    let kind: "main" | "child" = "main";
    try {
      const result = await ctx.client.session.get({ path: { id: sessionID } });
      const session = (result as { data?: { parentID?: string } | undefined }).data;
      if (session && typeof session.parentID === "string" && session.parentID) {
        kind = "child";
      }
    } catch {
      // If the lookup fails, treat as a main session (never block the chat).
    }
    sessionKind.set(sessionID, kind);
    return kind === "child";
  };

  return {
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID ?? output.message.sessionID;
      if (!sessionID || !engineReady()) return;
      if (await isChildSession(sessionID)) return;

      const prompt = (output.parts ?? [])
        .filter((p) => p.type === "text" && "text" in p && p.text && !p.synthetic)
        .map((p) => (p as { text: string }).text)
        .join("\n")
        .trim();

      const text = await runEngine("inject", { prompt, session_id: sessionID }, workspaceRoot);
      if (!text) return;

      output.parts.unshift({
        id: makeEarlyPartId(),
        sessionID: output.message.sessionID,
        messageID: output.message.id,
        type: "text",
        text: `<workhub-memory>\n${text}\n</workhub-memory>`,
        // LLM-only: hidden from the TUI user bubble, still sent to the model (T-0342).
        synthetic: true,
      });
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      const sessionID = (event.properties as { sessionID?: string } | undefined)?.sessionID;
      if (!sessionID || !engineReady()) return;
      if (await isChildSession(sessionID)) return;
      // session.idle fires after every turn; captures are deduplicated
      // engine-side, so a short cooldown just avoids useless process spawns.
      const last = capturedAt.get(sessionID) ?? 0;
      if (Date.now() - last < 60_000) return;
      capturedAt.set(sessionID, Date.now());

      try {
        const result = await ctx.client.session.messages({ path: { id: sessionID } });
        const entries = (result as { data?: MessageEntry[] | undefined }).data ?? [];
        const messages = toSimpleMessages(entries);
        if (!messages.length) return;
        const out = await runEngine(
          "capture-json",
          { session_id: sessionID, project: workspaceRoot, messages },
          workspaceRoot,
        );
        if (out) logMemory(workspaceRoot, `capture-json: ${out}`);
      } catch (e) {
        // Capture is best-effort; never surface an error into the session —
        // but do leave a trace, or a silent failure stays silent forever.
        logMemory(workspaceRoot, `capture-json: ${(e as Error).message}`);
      }
    },
  };
};

export default memoryPlugin;
export { memoryPlugin as server };
