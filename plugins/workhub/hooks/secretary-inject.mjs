// SessionStart hook: tell the session that the owner's questions go through
// the secretary agent first.
//
// The rule cannot live in the vault's CLAUDE.md, because tasks run in the
// *target* repository and never read it. This plugin is installed user scope,
// so injecting here is what makes the rule reach every session.
//
// Injects nothing at all when the feature is off or the owner has no decision
// policy yet — an unusable rule is not worth the tokens.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVault, secretaryEnabled } from "./lib.mjs";

const posix = (p) => p.replaceAll("\\", "/");

if (!secretaryEnabled()) process.exit(0);

const vault = resolveVault();
if (!vault) process.exit(0);

const policy = join(vault, "knowledge", "profile", "decision-policy.md");
if (!existsSync(policy)) process.exit(0);

const commsCli = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "comms-cli.mjs");

const additionalContext = `<secretary-agent>
Before asking the owner anything, consult the \`secretary\` subagent (Agent
tool, subagent_type "secretary"). It answers from the owner's decision policy
(${posix(policy)}) and returns either:

- DECIDE — act on its answer and append one line to
  \`_ai/logs/decisions.md\` in the vault: \`- <date> <task-id> [DECIDE] <choice> (basis: <basis>)\`.
- ESCALATE — file the question for the owner with
  \`node "${posix(commsCli)}" ask --task <id> --question "..." --context "..."\`,
  set \`blocked: true\` + \`blocked_note\` on the task, and continue with
  whatever does not depend on the answer.

The owner reads filed questions in the workhub app and in Obsidian, so a filed
question does not block them the way an interrupted terminal does.
</secretary-agent>`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  }),
);
