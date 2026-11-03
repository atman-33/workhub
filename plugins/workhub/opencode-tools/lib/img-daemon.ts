// Persistent loopback image server for the show-image tool. The tool spawns this once;
// it outlives individual tool calls and serves every registered image. Restarting the
// desktop app drops the registry (old URLs stop working; call show-image again).
//
// Runs under Bun (uses Bun.serve). The tool falls back to spawning a bun binary
// when it runs without a Bun global (plain node); set OPENCODE_BUN_BIN when bun
// is installed outside PATH.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 18923;

// Refuse a duplicate: Windows lets two processes share the port, which would split the registry.
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/health`);
  if (r.ok) {
    console.log("img-daemon: already running, exiting");
    process.exit(0);
  }
} catch {
  // nobody there; take the port
}
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const files = new Map<string, string>();
// Survive restarts: old URLs keep working as long as the files do.
const registry = join(tmpdir(), "opencode-img-registry.json");
try {
  const saved = JSON.parse(readFileSync(registry, "utf8")) as Record<string, string>;
  for (const [token, path] of Object.entries(saved)) {
    if (/^[a-f0-9]{16}$/.test(token) && existsSync(path)) files.set(token, path);
  }
} catch {
  // no usable registry yet
}
function persist(): void {
  try {
    writeFileSync(registry, JSON.stringify(Object.fromEntries(files)));
  } catch {
    // best effort; serving still works for this run
  }
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/register" && req.method === "POST") {
      const { path } = (await req.json()) as { path?: string };
      const ext = path ? extname(path).toLowerCase() : "";
      if (!path || !TYPES[ext] || !existsSync(path) || !statSync(path).isFile()) {
        return new Response("bad image", { status: 400 });
      }
      const token = randomBytes(8).toString("hex");
      files.set(token, path);
      persist();
      return Response.json({ token });
    }
    const m = url.pathname.match(/^\/img\/([a-f0-9]{16})$/);
    const file = m ? files.get(m[1]) : undefined;
    if (!file) return new Response("no such image", { status: 404 });
    try {
      const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
      return new Response(readFileSync(file), { headers: { "Content-Type": type } });
    } catch {
      return new Response("unreadable", { status: 404 });
    }
  },
});
