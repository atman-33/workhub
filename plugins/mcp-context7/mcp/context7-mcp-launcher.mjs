#!/usr/bin/env node
// @ts-check
/**
 * MCP launcher: start the Context7 MCP server (@upstash/context7-mcp) over stdio.
 *
 * Launched via `node` from the plugin's `.mcp.json` so a single launcher works
 * on both Windows and WSL/Linux/macOS.
 *
 *   - Prefer a global npm install (fast startup, no network).
 *   - Otherwise fall back to `npx` — using `cmd /c npx` on Windows, but plain
 *     `npx` elsewhere (WSL/Linux/macOS have no `cmd`).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const isWin = process.platform === "win32";

// Try the global npm install path first (fast startup, no network needed).
const globalPath = join(
  process.env.APPDATA || homedir(),
  "npm",
  "node_modules",
  "@upstash",
  "context7-mcp",
  "dist",
  "index.js",
);

let child;
if (existsSync(globalPath)) {
  child = spawn(process.execPath, [globalPath], { stdio: "inherit" });
} else if (isWin) {
  child = spawn("cmd", ["/c", "npx", "-y", "@upstash/context7-mcp"], {
    stdio: "inherit",
  });
} else {
  child = spawn("npx", ["-y", "@upstash/context7-mcp"], { stdio: "inherit" });
}

child.on("close", (code) => process.exit(code ?? 0));
