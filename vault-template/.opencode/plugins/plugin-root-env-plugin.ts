// Supplies CLAUDE_PLUGIN_ROOT to every shell command OpenCode runs, pointing at
// the workhub plugin's source tree.
//
// Why: the workhub skills call `node "${CLAUDE_PLUGIN_ROOT}/scripts/task-cli.mjs"`.
// Claude Code sets that variable; OpenCode does not, and the skill sync copies
// only `skills/<name>/`, so `scripts/` (and the `lib/` and `hooks/lib.mjs` it
// imports) never reach OpenCode. Rather than copy a second tree that would go
// stale, point the variable at the plugin where Claude Code installed it.
//
// Scope: workhub only, the one harness plugin whose skills ship scripts they
// run. A variable already set (an override, or a Claude Code child process)
// wins, and a missing tree sets nothing, so a machine without the plugin
// behaves exactly as before.
import type { Plugin } from "@opencode-ai/plugin";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { workhubPluginRoot } from "../scripts/lib/claude-plugin-sync-core.mjs";

const pluginRootEnvPlugin: Plugin = async (_ctx, _options) => {
  return {
    "shell.env": async (_input, output) => {
      if (output.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT) {
        return;
      }
      const root = workhubPluginRoot();
      if (existsSync(join(root, "scripts", "task-cli.mjs"))) {
        output.env.CLAUDE_PLUGIN_ROOT = root;
      }
    },
  };
};

export default pluginRootEnvPlugin;
