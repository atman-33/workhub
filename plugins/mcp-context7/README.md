# mcp-context7

The [context7](https://github.com/upstash/context7) MCP server: up-to-date
library and framework documentation lookup, so answers about a dependency come
from its current docs rather than from training data.

This plugin ships nothing but the server. It is split out from `engineering`
so context7 can be switched on or off independently of that plugin — and
independently of `mcp-serena`, which is far heavier (it pulls a Python
toolchain and language servers). Plugin enable/disable is Claude Code's only
granularity, so servers that share a plugin cannot be toggled separately.

## What it registers

| Server | Role |
|--------|------|
| `context7` | Up-to-date library/framework documentation lookup. |

The server is started through a small Node launcher under [`mcp/`](mcp/),
referenced via `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "context7": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/context7-mcp-launcher.mjs"] }
  }
}
```

### Why a launcher script?

Windows and WSL need different invocations, and a static `.mcp.json` cannot
branch on platform. The launcher does that branch at runtime via
`process.platform`, so **one `.mcp.json` works on both**.

## Requirements

- **Node.js** on `PATH`. Nothing else — the launcher falls back to
  `npx -y @upstash/context7-mcp`, which makes the first run slower. Install it
  globally to speed startup: `npm i -g @upstash/context7-mcp`. No API key is
  required.

After installing/reloading the plugin, confirm the server connects with `/mcp`.
