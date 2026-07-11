# OpenCode Log Error Reference

## Log File Locations

| OS | OpenCode Log | oh-my-opencode Log |
|----|-------------|-------------------|
| Windows | `%USERPROFILE%\.local\share\opencode\log\` | `%TEMP%\oh-my-opencode.log` |
| Linux | `~/.local/share/opencode/log/` | `/tmp/oh-my-opencode.log` |
| macOS | `~/.local/share/opencode/log/` | `/tmp/oh-my-opencode.log` |

## Common Error Patterns

### MCP Server Errors

| Error | Meaning | Resolution |
|-------|---------|------------|
| `MCP error -32000: Connection closed` | The MCP server process exited immediately. | Check if the command exists and is executable. |
| `The system cannot find the path specified` | The command (e.g., `/bin/bash`, `uvx`) is not found on Windows. | Use Windows-compatible commands or WSL. |
| `MCP error -32601: Method not found` | The MCP server does not support the requested method. | Usually harmless; may indicate an older server version. |

### Plugin Errors

| Pattern | Meaning |
|---------|---------|
| `service=plugin path=... loading plugin` | Plugin was discovered and is being loaded. |
| `Loaded 0 plugins` | No plugins were found. Check `opencode.json` `plugin` array and file paths. |
| `Failed to load plugin manifest` | The plugin's `plugin.json` is missing or malformed. |
| `Failed to load plugin command` | A command file inside the plugin is unreadable or has bad frontmatter. |

### Session & Tool Errors

| Pattern | Meaning |
|---------|---------|
| `service=session ... error=` | Session-level error (e.g., LLM API failure). |
| `service=tool.registry status=started invalid` | Tool registry validation issue. Usually recovers. |
| `service=shell-tool shell=...` | Shows which shell OpenCode is using. Check if expected. |

## Important Caveat

**Plugin `console.error` / `console.log` does NOT go to the OpenCode log.**

The OpenCode log file captures the main process output. If a plugin (like `agent-harness-plugin.ts`) prints errors, they appear in the terminal session where OpenCode runs, not in the log file. To debug plugin shell commands:

1. Run the suspect command manually in the terminal.
2. Or write the error to a temp file inside the plugin:
   ```typescript
   await ctx.$`echo "${err.message}" > /tmp/plugin-debug.log`;
   ```
