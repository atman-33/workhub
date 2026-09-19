// PreToolUse hook: a git worktree is created only when the task asked for one
// (T-0389).
//
// A task opts in with `worktree: true`. Twice an agent created one anyway on a
// task that had not — once "to be safe", once to keep a parallel subagent off
// the shared working tree — and both times the instructions saying not to
// were already in place. So this puts the owner's confirmation in front of
// the call instead of relying on the agent to remember: when the session's
// task has `worktree: true` the call passes untouched; in every other case
// (worktree off, unset, or no task at all) Claude Code asks the owner first.
//
// Asking rather than denying is deliberate: the owner may well say yes, and a
// denial would leave no way to go ahead once they had.
//
// Acts in every session, not only vault ones: tasks run in the target
// repository, which is exactly where a worktree gets created.
import {
  activeTaskWorktree,
  createsWorktree,
  readPayload,
  resolveConfiguredVault,
} from "./lib.mjs";

try {
  const payload = readPayload();
  if (!createsWorktree(payload.tool_name, payload.tool_input)) process.exit(0);

  const task = activeTaskWorktree(resolveConfiguredVault(), payload.session_id);
  if (task?.worktree) process.exit(0);

  const why = task
    ? `task ${task.id} does not set \`worktree: true\``
    : "this session is not working on a task that sets `worktree: true`";
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          `workhub worktree guard: ${why}. A worktree is only created when the task ` +
          `asks for one — confirm with the owner before creating it, even to avoid a ` +
          `clash with parallel work.`,
      },
    }),
  );
} catch {
  // Never break a tool call over the guard itself.
}
process.exit(0);
