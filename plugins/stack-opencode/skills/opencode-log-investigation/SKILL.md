---
name: opencode-log-investigation
description: Investigates OpenCode runtime errors by locating and analyzing log files. Use when OpenCode fails to start, plugins do not load, MCP servers error out, or terminal shows cryptic errors without details.
---

# OpenCode Log Investigation

## Quick start

1. Identify the latest log file:
   - **Windows:** `%USERPROFILE%\.local\share\opencode\log\`
   - **Linux/macOS:** `~/.local/share/opencode/log/`
2. Open the most recent `YYYY-MM-DDTHHMMSS.log`.
3. Search for `ERROR` lines to find the root cause.

## Workflows

### 1. Plugin loading issues

1. Search for `service=plugin` in the log.
2. Check if the target plugin appears as `loading plugin`.
3. If absent, verify `opencode.json` has the plugin in the `plugin` array.
4. If present but errors follow, inspect the stack trace immediately after the load line.

### 2. MCP server failures

1. Search for `service=mcp` and `ERROR`.
2. Common errors:
   - `MCP error -32000: Connection closed` → the command failed to start.
   - `The system cannot find the path specified` → the executable (e.g., `/bin/bash`, `uvx`) is missing or not in PATH.
3. Check the `command=` field in the error line to see the exact command invoked.

### 3. Session or tool errors

1. Search for `service=session` or `service=tool.registry`.
2. Look for `error=` or `failed` in the same block.
3. Cross-reference timestamps to match user-visible terminal errors with log entries.

### 4. Shell command errors inside plugins

1. If a plugin uses `ctx.$` to run shell commands, `console.error` output from the plugin may **not** appear in the OpenCode log.
2. Check the terminal output directly, or redirect plugin stderr to a temp file for debugging.
3. Verify the command exists in the OS PATH (e.g., `python3` vs `python` on Windows).

## Advanced features

- See [REFERENCE.md](REFERENCE.md) for a detailed error pattern catalog.
- For plugin-specific debugging, add `console.log` in the plugin and watch the terminal; OpenCode does not capture plugin stdout/stderr into its log file.
