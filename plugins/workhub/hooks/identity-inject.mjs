// SessionStart hook: tell the session who the owner is and how they decide.
//
// Two tiers, because they cost different amounts:
//
// 1. Always (whenever the owner has a decision policy) — read the profile,
//    attach a recommendation to every question, and feed answers back into the
//    policy. That costs only the tokens of the block itself, so it does not
//    hang off the secretary switch: the owner's preferences should shape how a
//    question is put even when nobody is paying for a secretary.
// 2. Only when the secretary agent is on — route questions through the
//    `secretary` subagent and file what it escalates. That spends a subagent
//    per question, so it stays behind the ⚙ Settings toggle.
//
// The rules cannot live in the vault's CLAUDE.md, because tasks run in the
// *target* repository and never read it. This plugin is installed user scope,
// so injecting here is what makes them reach every session.
//
// Injects nothing at all when the owner has no decision policy yet — an
// unusable rule is not worth the tokens.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveDecisionPolicy,
  resolveIdentityDir,
  resolveNotesDir,
  resolveVault,
  secretaryEnabled,
} from "./lib.mjs";

const posix = (p) => p.replaceAll("\\", "/");

const vault = resolveVault();
if (!vault) process.exit(0);

const policy = resolveDecisionPolicy(vault);
if (!existsSync(policy)) process.exit(0);

const aboutMe = join(resolveIdentityDir(vault), "about-me.md");
const notes = resolveNotesDir(vault);
const commsCli = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "comms-cli.mjs");

const blocks = [
  `<owner-identity>
Who the owner is, and how they decide, lives in the vault's memory:

- ${posix(policy)} — the axes: what you may decide alone, what has to come back
  to them, a \`## Preferences\` section describing how they like to work, and
  \`## Promoted rules\` for the axes that came out of past decisions. Short on
  purpose; read it in full.
- ${posix(notes)} — the cases: every individual call the owner has settled,
  one typed note each (\`type: decision\`). Do **not** read the folder whole —
  it grows without limit. Search it when the policy does not settle a question
  and a similar one may have come up before.
- ${posix(aboutMe)} — who they are and what context they already have.

Read the decision policy before putting any question to the owner, and act on
it:

- **Never ask an open question.** Use \`## Preferences\` and \`## Promoted rules\`
  to work out which answer the owner would most likely give, and present it as a
  recommended option, with the reason and the preference it came from. Ask
  without a recommendation only when the profile genuinely does not lean either
  way — and say that is why.
- **Feed the answer back.** Whenever the owner settles a question, write it as
  a note in that folder with \`type: decision\`, \`status: accepted\` and a
  \`[decision]\` observation carrying the rule it establishes — plus
  \`[rationale]\` and \`[alternative]\` where the conversation produced them.
  When the answer reveals a standing leaning rather than a one-off call, add it
  to the policy's \`## Preferences\` instead and say so; when the same reasoning
  has now settled a second question, promote it to the policy's
  \`## Promoted rules\` as an axis. This is what stops the same question being
  asked twice.
</owner-identity>`,
];

if (secretaryEnabled()) {
  blocks.push(`<secretary-agent>
Before asking the owner anything, consult the \`secretary\` subagent (Agent
tool, subagent_type "secretary"). It answers from the same decision policy and
returns either:

- DECIDE — act on its answer and record it as a note in
  \`${posix(notes)}\`: \`type: decision\`, \`status: accepted\`,
  \`decided_by: secretary\`, a \`[decision]\` observation with its choice and a
  \`[rationale]\` observation with its basis. This is precedent for the next
  secretary run, marked apart from a call the owner made themselves.
- ESCALATE — file the question for the owner with
  \`node "${posix(commsCli)}" ask --task <id> --question "..." --context "..."\`,
  set \`blocked: true\` + \`blocked_note\` on the task, and continue with
  whatever does not depend on the answer.

The owner reads filed questions in the workhub app and in Obsidian, so a filed
question does not block them the way an interrupted terminal does. The
recommendation rule above still applies: what you file carries the recommended
option and its reason.
</secretary-agent>`);
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: blocks.join("\n\n"),
    },
  }),
);
