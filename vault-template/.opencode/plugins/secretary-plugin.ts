// OpenCode adapter for the workhub secretary agent.
//
// Mirrors the Claude Code hooks shipped in the workhub plugin
// (plugins/workhub/hooks/secretary-*.mjs) — keep the two sides behaviorally
// aligned. The pieces map like this:
//
//   identity-inject.mjs   -> session `prompt` hook (rules injected once per session)
//   secretary-consulted.mjs -> `tool.execute.after` on the task tool
//   secretary-gate.mjs    -> the `ask_owner` tool below
//
// The gate is the one part that cannot be a straight port. Claude has an
// AskUserQuestion tool to intercept; OpenCode has none, so instead of catching
// a question on its way out we *provide* the sanctioned way to ask and put the
// check inside it. That is stronger where it applies — the enforcement is our
// own code rather than a hook the model may route around — but it still cannot
// stop a model that simply asks in prose. The injected rule is what covers
// that case, on both harnesses.
//
// The injected rules come in two tiers, mirroring identity-inject.mjs. The
// owner-identity block (read the decision policy, attach a recommendation to
// every question, feed answers back) needs only a decision policy in the vault,
// so it applies whether or not the secretary is on. The secretary block and the
// `ask_owner` tool additionally require the workhub app setting
// `secretary_enabled` to be explicitly true (~/.workhub/config.json) — off by
// default, since consulting a subagent costs tokens. Everything no-ops when the
// vault has no decision policy to judge from.
import { Plugin } from "@opencode/plugin";
import {
  isChildSession,
  nodeExecutable,
  normalizePath,
  readSessionIdentity,
} from "./lib/project-context-core.ts";
import {
  defaultClaudePluginsRoot,
  readProjectEnabledPlugins,
  readUserEnabledPlugins,
  resolveProjectPluginRoot,
} from "../scripts/lib/claude-plugin-sync-core.mjs";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COMMS_CLI_TIMEOUT_MS = 15_000;

const posix = (p: string): string => p.replaceAll("\\", "/");

// Same file format and directory as plugins/workhub/hooks/secretary-state.mjs,
// so a session that consulted the secretary under one harness is recognized by
// the other.
const STATE_DIR = join(homedir(), ".workhub", "secretary");

type SecretaryState = { consulted: boolean; blocks: number };

function readState(sessionID: string): SecretaryState {
  try {
    return JSON.parse(readFileSync(statePath(sessionID), "utf8")) as SecretaryState;
  } catch {
    return { consulted: false, blocks: 0 };
  }
}

function writeState(sessionID: string, state: SecretaryState): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(statePath(sessionID), JSON.stringify(state));
  } catch {
    // State is an optimization, not a guarantee.
  }
}

function statePath(sessionID: string): string {
  return join(STATE_DIR, `${(sessionID || "default").replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

function readAppConfig(): Record<string, any> {
  for (const dir of [
    join(homedir(), ".workhub"),
    process.env.APPDATA ? join(process.env.APPDATA, "workhub") : null,
  ]) {
    if (!dir) continue;
    try {
      return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    } catch {
      // try the next location
    }
  }
  return {};
}

function resolveVault(workspaceRoot: string): string | null {
  if (process.env.WORKHUB_VAULT) return process.env.WORKHUB_VAULT;
  if (existsSync(join(workspaceRoot, "tasks")) && existsSync(join(workspaceRoot, "_ai"))) {
    return workspaceRoot;
  }
  const cfg = readAppConfig();
  return cfg.settings?.vault_path ?? cfg.vault_path ?? null;
}

/**
 * Locate `comms-cli.mjs` inside the enabled workhub Claude plugin. Questions
 * are filed by that CLI on both harnesses so id allocation and the file format
 * have exactly one implementation. Project-scope enables are checked first,
 * then user-scope ones (plugins are user-scope only, so this is the lookup
 * that succeeds on a fresh vault).
 */
function resolveCommsCli(workspaceRoot: string): string | null {
  const root = defaultClaudePluginsRoot();
  const candidates = [
    ...readProjectEnabledPlugins(workspaceRoot),
    ...readUserEnabledPlugins(),
  ];
  for (const plugin of candidates) {
    const candidate = join(resolveProjectPluginRoot(plugin, root), "scripts", "comms-cli.mjs");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function runCommsCli(cli: string, args: string[], vault: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      nodeExecutable(),
      [cli, ...args, "--vault", vault],
      { timeout: COMMS_CLI_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout.trim());
      },
    );
  });
}

interface AskOwnerInput {
  question: string;
  context?: string;
  options?: string[];
  task?: string;
}

export default Plugin.define({
  id: "secretary",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);
    const vault = resolveVault(workspaceRoot);
    // Same layout as plugins/workhub/hooks/lib.mjs (resolveIdentityDir and
    // friends). No fallback to the pre-migration `profile/`: the vault-upgrade
    // skill moves it, and a fallback would hide a vault that was never migrated.
    const identityDir = vault ? join(vault, "memory", "identity") : null;
    const policyPath = identityDir ? posix(join(identityDir, "decision-policy.md")) : null;

    // Tier 1 needs nothing but a decision policy to read; tier 2 additionally
    // needs the app setting, because it spends a subagent per question.
    if (!vault || !identityDir || !policyPath || !existsSync(policyPath)) return;
    const secretaryOn = readAppConfig().settings?.secretary_enabled === true;

    const injected = new Set<string>();
    const childCache = new Map<string, boolean>();
    const aboutMePath = posix(join(identityDir, "about-me.md"));
    const notesDir = posix(join(vault, "memory", "notes"));

    const identityRule = [
      "<owner-identity>",
      "Who the owner is, and how they decide, lives in the vault's memory:",
      "",
      `- ${policyPath} — the axes: what you may decide alone, what has to come`,
      "  back to them, a `## Preferences` section describing how they like to work,",
      "  and `## Promoted rules` for the axes that came out of past decisions.",
      "  Short on purpose; read it in full.",
      `- ${notesDir} — the cases: every individual call the owner has settled,`,
      "  one typed note each (`type: decision`). Do **not** read the folder whole —",
      "  it grows without limit. Search it when the policy does not settle a",
      "  question and a similar one may have come up before.",
      `- ${aboutMePath} — who they are and what context they already have.`,
      "",
      "Read the decision policy before putting any question to the owner, and act",
      "on it:",
      "",
      "- **Never ask an open question.** Use `## Preferences` and `## Promoted rules`",
      "  to work out which answer the owner would most likely give, and present it",
      "  as a recommended option, with the reason and the preference it came from.",
      "  Name that preference by its `P-NN` id (`recommended: A — P-07`): it is how",
      "  the policy learns which entries are still used. Ask without a",
      "  recommendation only when the profile genuinely does not lean either way —",
      "  and say that is why.",
      "- **Feed the answer back.** Whenever the owner settles a question, write it",
      "  as a note in that folder with `type: decision`, `status: accepted` and a",
      "  `[decision]` observation carrying the rule it establishes — plus",
      "  `[rationale]` and `[alternative]` where the conversation produced them.",
      "  When the answer reveals a standing leaning rather than a one-off call, add",
      "  it to the policy's `## Preferences` instead and say so; when the same",
      "  reasoning has now settled a second question, promote it to the policy's",
      "  `## Promoted rules` as an axis. This is what stops the same question being",
      "  asked twice. A new policy entry must be an axis (not a case), must not",
      "  overlap an existing one, and must say something the model would not do",
      "  unprompted; it opens with the next unused `P-NN`. The policy holds 50",
      "  entries at most — a 51st arrives by merging or dropping one.",
      "</owner-identity>",
    ].join("\n");

    const secretaryRule = [
      "<secretary-agent>",
      "Before asking the owner anything, consult the `secretary` subagent (the task",
      `tool, agent "secretary"). It answers from the owner's decision policy`,
      `(${policyPath}) and returns either:`,
      "",
      "- DECIDE — act on its answer and record it as a note under",
      `  ${notesDir}: \`type: decision\`, \`status: accepted\`,`,
      "  `decided_by: secretary`, a `[decision]` observation with its choice and a",
      "  `[rationale]` observation with its basis.",
      secretaryOn
        ? "- ESCALATE — call the `ask_owner` tool with the question, its context and the\n  options. It files the question for the owner and the task carries on."
        : "- ESCALATE — file the question in the vault's `_ai/comms/` and carry on.",
      "",
      "Set `blocked: true` and `blocked_note` on the task when you file a question,",
      "then continue with whatever does not depend on the answer. The owner reads",
      "filed questions in the workhub app and in Obsidian, so a filed question does",
      "not block them the way an interrupted terminal does. The recommendation",
      "rule above still applies: what you file carries the recommended option and",
      "its reason.",
      "</secretary-agent>",
    ].join("\n");

    const rule = secretaryOn ? `${identityRule}\n\n${secretaryRule}` : identityRule;

    if (secretaryOn) {
      await ctx.tool.transform((editor) => {
        editor.add({
          name: "ask_owner",
          description:
            "File a question for the owner (workhub). Use this instead of asking the " +
            "owner directly. Requires consulting the `secretary` subagent first — it " +
            "decides most questions itself, and this tool is only for what it escalates.",
          input: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The single question, self-contained.",
              },
              context: {
                type: "string",
                description:
                  "Background the owner needs in order to answer, 2-4 lines.",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description:
                  'Options to choose from, e.g. "A: keep the current name".',
              },
              task: {
                type: "string",
                description: "Related task id, e.g. T-0042.",
              },
            },
            required: ["question"],
            additionalProperties: false,
          },
          execute: async (rawInput, context) => {
            const args = rawInput as AskOwnerInput;
            const state = readState(context.sessionID);
            if (!state.consulted) {
              return {
                content:
                  "Not filed. Consult the `secretary` subagent first (task tool, agent " +
                  '"secretary"), passing this question, its options and the task context. ' +
                  "If it answers DECIDE, act on that and record it as a `type: decision` note " +
                  `(\`decided_by: secretary\`) under ${notesDir} instead of asking. Call ` +
                  "ask_owner again only for what it escalates.",
              };
            }

            const cli = resolveCommsCli(workspaceRoot);
            if (!cli) {
              return {
                content:
                  "Could not find comms-cli.mjs — the workhub Claude plugin does not look " +
                  "installed. Write the question into the vault's `_ai/comms/` by hand, " +
                  "following the format of the files already there.",
              };
            }

            const cliArgs = ["ask", "--question", args.question];
            if (args.context) cliArgs.push("--context", args.context);
            if (args.task) cliArgs.push("--task", args.task);
            for (const option of args.options ?? []) cliArgs.push("--option", option);

            try {
              const output = await runCommsCli(cli, cliArgs, vault);
              // Re-arm the gate so the next question is checked again.
              writeState(context.sessionID, { ...state, consulted: false });
              return {
                content:
                  `${output}\n\nMark the task blocked (\`blocked: true\` with a ` +
                  "`blocked_note` naming the question) and continue with whatever does not " +
                  "depend on the answer.",
              };
            } catch (error) {
              return {
                content: `Failed to file the question: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              };
            }
          },
        });
      });
    }

    await ctx.session.hook("prompt", async (event) => {
      if (injected.has(event.sessionID)) return;
      // The secretary's own session does not need to be told to consult itself,
      // and neither does any other sub-agent session.
      if (await isChildSession(ctx, event.sessionID, childCache)) return;
      const identity = await readSessionIdentity(ctx, event.sessionID);
      if (identity.agent === "secretary") return;
      injected.add(event.sessionID);

      event.prompt.text = `${rule}\n\n${event.prompt.text}`;
    });

    await ctx.tool.hook("execute.after", (event) => {
      if (!secretaryOn) return;
      if (event.status !== "completed") return;
      if (event.tool !== "task") return;
      const input = event.input as { subagent_type?: string; agent?: string };
      const agent = String(input?.agent ?? "");
      const subagent = String(input?.subagent_type ?? "");
      if (!`${agent} ${subagent}`.toLowerCase().includes("secretary")) return;
      writeState(event.sessionID, { ...readState(event.sessionID), consulted: true });
    });
  },
});
