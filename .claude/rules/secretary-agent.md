---
paths:
  - "plugins/workhub/hooks/secretary-*.mjs"
  - "plugins/workhub/agents/**"
  - "plugins/workhub/scripts/comms-cli.mjs"
  - "vault-template/.opencode/**"
  - "**/agents/*.md"
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

- **The gate needs a question *tool* to intercept**, so it cannot catch an
  agent that simply asks in prose. Only the injected rule covers that case, on
  either harness.
- **OpenCode gets there from the other direction.** It has no question tool to
  hook, so `vault-template/.opencode/plugins/secretary-plugin.ts` *provides*
  the sanctioned one (`ask_owner`) and puts the check inside it — enforcement
  in our own code rather than a hook the model might route around. Two things
  make that work: the `tool` helper is imported **dynamically** (it is a
  runtime value, and a host without it must degrade to injection-only rather
  than fail to load), and `sync-claude-skills.mjs` now carries plugin
  `agents/` into `.opencode/agent/`, rewriting the frontmatter
  (`claudeAgentToOpenCode`). `model:` is dropped there on purpose — Claude's
  short aliases ("haiku") are not OpenCode model ids, and guessing a provider
  would break every setup that uses a different one.
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
