#!/usr/bin/env node
// @ts-check
/**
 * MCP launcher: start the Serena MCP server (oraios/serena) over stdio.
 *
 * Launched via `node` from the plugin's `.mcp.json` so a single launcher works
 * on both Windows and WSL/Linux/macOS — the platform branch lives here at
 * runtime, which a static `.mcp.json` cannot express.
 *
 *   - Windows -> invoke `uvx` directly (with --native-tls / pinned Python 3.11).
 *   - WSL/Linux/macOS -> run `uvx` inside a login shell so PATH/uv are resolved.
 */

import { spawn } from "node:child_process";

const isWin = process.platform === "win32";

const serenaArgs = [
  "--from",
  "git+https://github.com/oraios/serena",
  "serena",
  "start-mcp-server",
  "--open-web-dashboard",
  "false",
  "--context",
  "ide",
];

let child;
if (isWin) {
  child = spawn("uvx", ["--native-tls", "--python", "3.11", ...serenaArgs], {
    stdio: "inherit",
  });
} else {
  const cmd = ["uvx", ...serenaArgs].join(" ");
  child = spawn("/bin/bash", ["-l", "-c", cmd], { stdio: "inherit" });
}

child.on("close", (code) => process.exit(code ?? 0));
