---
paths:
  - "plugins/workhub/hooks/secretary-*.mjs"
  - "plugins/workhub/agents/**"
  - "plugins/workhub/scripts/comms-cli.mjs"
  - "vault-template/.opencode/**"
---

# Secretary agent: what makes the rule hold, and where it does not

The secretary only reduces interruptions if sessions actually consult it. The
instruction alone does not achieve that, so the mechanism is built from three
parts with different failure modes:

- `secretary-inject.mjs` (SessionStart) states the rule. It reaches every
  session because this plugin is installed **user scope** — the vault's
  `CLAUDE.md` cannot do this job, since tasks run in the *target* repository
  and never read it.
- `secretary-gate.mjs` (PreToolUse on `AskUserQuestion`) is what actually
  enforces it: injected instructions decay over a long session, a hook fires
  every time. It denies the first questions of a session until the secretary
  has been consulted.
- `secretary-consulted.mjs` (PostToolUse on `Task`) records the consultation,
  because the gate runs in a different process and has no other way to know.

Two consequences worth keeping in mind before changing any of them:

- **The gate needs a question *tool* to intercept.** It cannot catch an agent
  that simply asks in prose, and it cannot exist at all on a CLI without such
  a tool. OpenCode is exactly that case: its plugin API has
  `tool.execute.before`, but there is no question tool to match, and
  `.opencode/scripts/sync-claude-*.mjs` syncs commands and skills only — never
  `agents/`. So an OpenCode session gets neither the secretary subagent nor
  the gate. Any OpenCode support has to be built as its own mirror plugin, the
  way `memory-plugin.ts` mirrors the memory hooks.
- **The gate must never deadlock a session.** If the secretary is unreachable,
  an agent that keeps being denied has no way forward. `MAX_BLOCKS` in
  `secretary-state.mjs` is the safety valve: after that many blocks the gate
  stands down for the rest of the session. Keep it small, and keep the state
  per-session (`~/.workhub/secretary/<session-id>.json`).

Everything switches off through `settings.secretary_enabled` in
`~/.workhub/config.json`, and every hook checks it first — with the feature off
nothing is injected and nothing is consulted, which is the point (consulting a
subagent costs tokens). The hooks also stay silent when the vault has no
`knowledge/profile/decision-policy.md`, since the secretary would have no
authority to judge from.
