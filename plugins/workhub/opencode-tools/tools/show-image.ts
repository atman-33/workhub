import { tool } from "@opencode-ai/plugin";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 18923;
const DAEMON_URL = `http://127.0.0.1:${PORT}`;

declare const Bun: {
  spawn(cmd: string[], opts: { cwd?: string; stdio?: unknown[] }): unknown;
};

// Resolve a bun binary for environments where the tool runs without a Bun
// global (plain node, e.g. the Desktop sidecar). `process.execPath` is the bun
// binary itself when running under bun, so no PATH lookup is needed there.
// Otherwise fall back to PATH (`bun`) with an env override for machines where
// bun is installed outside PATH. No machine-specific absolute path belongs here.
function bunCommand(): string {
  const override = process.env.OPENCODE_BUN_BIN?.trim();
  if (override) return override;
  return "bun";
}

async function ensureDaemon(directory: string): Promise<true | string> {
  let healthError = "";
  try {
    const r = await fetch(`${DAEMON_URL}/health`);
    if (r.ok) return true;
    healthError = `status ${r.status}`;
  } catch (e) {
    healthError = `${e}`;
  }
  const runtime = typeof Bun === "undefined" ? "no-bun" : "bun";
  const daemon = fileURLToPath(new URL("../lib/img-daemon.ts", import.meta.url));
  let spawned = false;
  let spawnError = "";
  if (runtime === "bun") {
    try {
      // process.execPath is the bun binary itself: no PATH lookup needed.
      (Bun as typeof import("bun")).spawn([process.execPath, daemon], {
        cwd: directory,
        stdio: ["ignore", "ignore", "ignore"],
      });
      spawned = true;
    } catch (e) {
      spawnError = `bun-spawn: ${e}`;
    }
  }
  if (!spawned) {
    try {
      // Fallback when tools run without a Bun global (plain node): resolve bun
      // via PATH (or OPENCODE_BUN_BIN when set).
      spawn(bunCommand(), [daemon], { cwd: directory, stdio: "ignore", detached: true }).unref();
      spawned = true;
    } catch (e) {
      spawnError += ` node-spawn: ${e}`;
    }
  }
  if (!spawned) return `spawn failed (runtime=${runtime} exec=${process.execPath}): ${spawnError}`;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      if ((await fetch(`${DAEMON_URL}/health`)).ok) return true;
    } catch {
      // still starting
    }
  }
  return `daemon spawned but health never ok (first health: ${healthError}; runtime=${runtime} exec=${process.execPath}; ${spawnError})`;
}

export default tool({
  description:
    "Show a local image file to the user inside the chat. The desktop client cannot render local file paths, so this serves the image over loopback HTTP. After calling it, paste the returned markdown line into your reply unchanged.",
  args: {
    path: tool.schema.string().describe("Absolute path to a PNG, JPEG, GIF or WebP image"),
    caption: tool.schema.string().describe("Alt text for the image").optional(),
  },
  async execute(args, context) {
    const ready = await ensureDaemon(context.directory);
    if (ready !== true) {
      return `error: image server unavailable (${ready}); tell the user images are unavailable right now`;
    }
    const r = await fetch(`${DAEMON_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: args.path }),
    });
    if (!r.ok) return `error: the image was rejected (png, jpg, gif, webp only): ${args.path}`;
    const { token } = (await r.json()) as { token: string };
    const line = `![${args.caption ?? "screenshot"}](${DAEMON_URL}/img/${token})`;
    return `Paste this line into your reply unchanged so the user sees the image:\n\n${line}`;
  },
});
