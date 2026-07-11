#!/usr/bin/env node
// @ts-check
/**
 * MCP launcher: start the monday.com API MCP server
 * (@mondaydotcomorg/monday-api-mcp) over stdio.
 *
 * Launched via `node` from the plugin's `.mcp.json` so a single launcher works
 * on both Windows and WSL/Linux/macOS — the platform branch lives here at
 * runtime, which a static `.mcp.json` cannot express.
 *
 *   - Prefer a global npm install (fast startup, no network).
 *   - Otherwise fall back to `npx` — using `cmd /c npx` on Windows, but plain
 *     `npx` elsewhere (WSL/Linux/macOS have no `cmd`).
 *
 * Requires a monday.com API token in the `MONDAY_TOKEN` environment variable
 * (see the plugin README). The token is never read from a file, so nothing
 * secret ends up in a config that could be committed.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const isWin = process.platform === "win32";

const token = process.env.MONDAY_TOKEN;
if (!token) {
  process.stderr.write(
    "monday-api-mcp-launcher: MONDAY_TOKEN environment variable is not set.\n" +
      "Get an API token from https://developer.monday.com/api-reference/docs/authentication " +
      "and export it (e.g. in ~/.zshrc): export MONDAY_TOKEN=your_token_here\n"
  );
  process.exit(1);
}

const tokenArgs = ["-t", token];

// Try the global npm install path first (fast startup, no network needed).
const globalPath = join(
  process.env.APPDATA || homedir(),
  "npm",
  "node_modules",
  "@mondaydotcomorg",
  "monday-api-mcp",
  "dist",
  "index.js"
);

let child;
if (existsSync(globalPath)) {
  child = spawn(process.execPath, [globalPath, ...tokenArgs], {
    stdio: "inherit",
  });
} else if (isWin) {
  child = spawn(
    "cmd",
    ["/c", "npx", "-y", "@mondaydotcomorg/monday-api-mcp@latest", ...tokenArgs],
    { stdio: "inherit" }
  );
} else {
  child = spawn(
    "npx",
    ["-y", "@mondaydotcomorg/monday-api-mcp@latest", ...tokenArgs],
    { stdio: "inherit" }
  );
}

child.on("close", (code) => process.exit(code ?? 0));
