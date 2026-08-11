// PreToolUse (AskUserQuestion) hook: catch the moment the session is about to
// interrupt the owner, and send it to the secretary first.
//
// This is what actually makes the rule hold. Injected instructions decay over
// a long session; a hook fires every time, at exactly the point where the
// agent decided to ask. When the secretary was already consulted (recorded by
// secretary-consulted.mjs) the question passes straight through.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPayload, resolveVault, secretaryEnabled } from "./lib.mjs";
import { MAX_BLOCKS, readState, writeState } from "./secretary-state.mjs";

if (!secretaryEnabled()) process.exit(0);

const vault = resolveVault();
if (!vault) process.exit(0);
if (!existsSync(join(vault, "knowledge", "profile", "decision-policy.md"))) process.exit(0);

const payload = readPayload();
const sessionId = payload?.session_id;
const state = readState(sessionId);

// Consulted since the last question: let this one through and re-arm, so the
// next question is gated again.
if (state.consulted) {
  writeState(sessionId, { ...state, consulted: false });
  process.exit(0);
}

// Safety valve: if the secretary is unreachable the session must not deadlock
// bouncing between hook and question. Block a couple of times, then stand down
// for the rest of the session.
if ((state.blocks ?? 0) >= MAX_BLOCKS) process.exit(0);

writeState(sessionId, { ...state, blocks: (state.blocks ?? 0) + 1 });

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "workhub secretary: consult the `secretary` subagent before asking the owner " +
        "(Agent tool, subagent_type \"secretary\"; pass the question, the options and the task context). " +
        "If it answers DECIDE, act on it and log the decision in the vault's `_ai/logs/decisions.md` " +
        "instead of asking. If it answers ESCALATE, file the question with " +
        "`scripts/comms-cli.mjs ask` and mark the task blocked — the owner answers it in the workhub app. " +
        "Ask here only when the secretary is unavailable.",
    },
  }),
);
