# mcp-serena

The [Serena](https://github.com/oraios/serena) MCP server: semantic,
symbol-aware code retrieval and editing (`find_symbol`,
`find_referencing_symbols`, `replace_symbol_body`, and friends).

This plugin ships nothing but the server. It is split out from `engineering`
so Serena can be switched off without losing that plugin's skills and
sub-agents — plugin enable/disable is Claude Code's only granularity, so a
server that is bundled with anything else cannot be turned off on its own.

`engineering`'s `code-explore`, `implementer` and `heavy-implementer` agents
use Serena's tools when this plugin is enabled, and fall back to
`Grep`/`Glob`/`Edit` when it is not.

## What it registers

| Server | Role |
|--------|------|
| `serena` | Semantic code retrieval / editing toolkit, run via `uvx`. |

The server is started through a small Node launcher under [`mcp/`](mcp/),
referenced via `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "serena": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/serena-mcp-launcher.mjs"] }
  }
}
```

### Why a launcher script?

Windows and WSL need different invocations (Windows calls `uvx` directly;
WSL/Linux runs it inside a login shell so `PATH`/`uv` resolve), and a static
`.mcp.json` cannot branch on platform. The launcher does that branch at runtime
via `process.platform`, so **one `.mcp.json` works on both**.

## Requirements

- **Node.js** on `PATH`.
- [`uv`/`uvx`](https://docs.astral.sh/uv/) on `PATH`. On WSL it must resolve in
  a login shell (`bash -l`). The first launch pulls Serena from git and may
  take a while.

After installing/reloading the plugin, confirm the server connects with `/mcp`.

## Troubleshooting

### The server fails to start with an SSL error from `tiktoken`

Symptom — the MCP server never connects, and the Serena log
(`~/.serena/logs/<date>/`) ends in:

```text
requests.exceptions.SSLError: HTTPSConnectionPool(host='openaipublic.blob.core.windows.net', port=443):
Max retries exceeded with url: /encodings/o200k_base.tiktoken
(Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed:
unable to get local issuer certificate')))
```

Cause — `~/.serena/serena_config.yml` carries
`token_count_estimator: TIKTOKEN_GPT4O`. Older Serena releases generated that
value; current Serena defaults to `CHAR_COUNT`. `SerenaAgent.__init__` builds
the token estimator unconditionally — even with `record_tool_usage_stats:
false` — so the tiktoken estimator downloads its encoding file at startup.
`requests` trusts only the `certifi` bundle, so on a machine whose TLS is
intercepted (corporate proxy, antivirus HTTPS scanning) the download fails and
takes the whole server down with it.

Fix — edit `~/.serena/serena_config.yml`:

```yaml
token_count_estimator: CHAR_COUNT
```

That removes the network call entirely. Nothing is lost unless
`record_tool_usage_stats` is enabled, and even then `CHAR_COUNT` is Serena's
own default estimator.

To confirm the diagnosis before changing anything, compare how the same Python
verifies the host with the system trust store and with `certifi` — the system
store succeeding while `certifi` fails is the interception signature.
Adding the intercepting CA to `certifi` also works, but the bundle is replaced
on every reinstall, so it is not worth the maintenance.
