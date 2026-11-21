// OpenCode adapter for the workhub long-term memory engine.
//
// Mirrors the Claude Code hooks shipped in the workhub plugin
// (plugins/workhub/hooks/memory-capture.mjs / memory-inject.mjs) — keep the
// two sides behaviorally aligned:
//   - inject: on each user prompt, run the engine's `inject` command and
//     prepend the returned context block (time summary + reminder on the
//     session's first prompt, relevance-gated related memories every prompt).
//   - capture: on session idle, read the session's transcript and hand it
//     to the engine's `capture-json` command (pairing/noise filtering and
//     background embedding live engine-side).
//
// The engine itself is NOT bundled here (no runtime npm deps allowed): setup
// (`/memory-setup`) installs a version-stable copy under
// `~/.workhub/memory-engine/engine/`, and this plugin shells out to its CLI
// with `node`. Everything no-ops silently until that setup has run, and the
// whole feature can be turned off for OpenCode via the workhub app setting
// `memory_opencode` (~/.workhub/config.json).
import { Plugin } from "@opencode/plugin";
import {
  isChildSession,
  nodeExecutable,
  normalizePath,
  readSessionMessages,
  safeReadText,
  stripInjectedBlocks,
} from "./lib/project-context-core.ts";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENGINE_HOME = join(homedir(), ".workhub", "memory-engine");
const ENGINE_CLI = join(ENGINE_HOME, "engine", "cli.mjs");
const MARKER_PATH = join(ENGINE_HOME, ".setup-version");
// Vector search loads an ONNX model (~2.5 s); leave generous headroom but
// never let a wedged engine process hang the chat or the idle handler.
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
    appendFileSync(join(dir, "memory.log"), `${new Date().toISOString()} ${line}\n`);
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
      const child = spawn(nodeExecutable(), [ENGINE_CLI, command], {
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

interface SimpleMessage {
  role: string;
  text: string;
  timestamp: string;
}

function toSimpleMessages(entries: unknown[]): SimpleMessage[] {
  const messages: SimpleMessage[] = [];
  for (const entry of entries) {
    const msg = entry as {
      type?: string;
      text?: unknown;
      content?: unknown;
      time?: { created?: unknown };
    };
    const timestamp =
      typeof msg?.time?.created === "number"
        ? new Date(msg.time.created).toISOString()
        : "";
    if (msg?.type === "user" && typeof msg.text === "string") {
      // Strip harness-injected blocks (memory context, project guidance,
      // persona ...) so the engine never learns from its own output.
      const text = stripInjectedBlocks(msg.text).trim();
      if (!text) continue;
      messages.push({ role: "user", text, timestamp });
    } else if (msg?.type === "assistant" && Array.isArray(msg.content)) {
      const text = stripInjectedBlocks(
        msg.content
          .filter(
            (p): p is { type: string; text: string } =>
              typeof p === "object" &&
              p !== null &&
              (p as { type?: unknown }).type === "text" &&
              typeof (p as { text?: unknown }).text === "string",
          )
          .map((p) => p.text)
          .join("\n"),
      ).trim();
      if (!text) continue;
      messages.push({ role: "assistant", text, timestamp });
    }
  }
  return messages;
}

export default Plugin.define({
  id: "memory",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);
    // Session ids confirmed as sub-agent (or confirmed main) sessions.
    const sessionKind = new Map<string, boolean>();
    const capturedAt = new Map<string, number>();

    await ctx.session.hook("prompt", async (event) => {
      const sessionID = event.sessionID;
      if (!sessionID || !engineReady()) return;
      if (await isChildSession(ctx, sessionID, sessionKind)) return;

      const prompt = event.prompt.text.trim();
      if (!prompt) return;

      const text = await runEngine("inject", { prompt, session_id: sessionID }, workspaceRoot);
      if (!text) return;

      event.prompt.text = `<workhub-memory>\n${text}\n</workhub-memory>\n\n${event.prompt.text}`;
    });

    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: ["session.idle"],
        signal: controller.signal,
      })) {
        // SessionIdle carries the id in `data`; tolerate the legacy V1
        // `properties` shape so a client skew fails open (skips, never throws).
        const data = (event as unknown as { data?: unknown; properties?: unknown }).data ??
          (event as unknown as { properties?: unknown }).properties;
        const sessionID =
          typeof data === "object" && data !== null
            ? (data as { sessionID?: unknown }).sessionID
            : undefined;
        if (typeof sessionID !== "string" || !sessionID || !engineReady()) continue;
        if (await isChildSession(ctx, sessionID, sessionKind)) continue;
        // session.idle fires after every turn; captures are deduplicated
        // engine-side, so a short cooldown just avoids useless process spawns.
        const last = capturedAt.get(sessionID) ?? 0;
        if (Date.now() - last < 60_000) continue;
        capturedAt.set(sessionID, Date.now());

        try {
          const messages = toSimpleMessages(await readSessionMessages(ctx, sessionID));
          if (!messages.length) continue;
          // Success is not logged: `memory-doctor` reads any entry in memory.log
          // as a problem, and the engine already records a successful capture in
          // its capture health (T-0371). runEngine logs the failures.
          await runEngine(
            "capture-json",
            { session_id: sessionID, project: workspaceRoot, messages },
            workspaceRoot,
          );
        } catch (e) {
          // Capture is best-effort; never surface an error into the session —
          // but do leave a trace, or a silent failure stays silent forever.
          logMemory(workspaceRoot, `capture-json: ${(e as Error).message}`);
        }
      }
    })();

    return () => controller.abort();
  },
});
