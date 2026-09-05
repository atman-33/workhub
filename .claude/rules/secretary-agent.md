---
paths:
  - "plugins/workhub/hooks/secretary-*.mjs"
  - "plugins/workhub/hooks/profile-inject.mjs"
  - "plugins/workhub/agents/**"
  - "plugins/workhub/scripts/comms-cli.mjs"
  - "plugins/workhub/skills/strategist/**"
  - "plugins/persona/scripts/**"
  - "vault-template/strategy/**"
  - "vault-template/profile/strategist.md"
  - "vault-template/.opencode/**"
  - "**/agents/*.md"
---

# Answering the owner: the gate, the counsel, and where each stops

## Secretary: what makes the rule hold, and where it does not

The secretary only reduces interruptions if sessions actually consult it. The
instruction alone does not achieve that, so the mechanism is built from three
parts with different failure modes:

- `profile-inject.mjs` (SessionStart) states the rules. It reaches every
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

### Two tiers, gated differently (T-0205)

`profile-inject.mjs` emits two blocks, and only the second is behind the
settings flag:

- **owner-profile** — read `profile/decision-policy.md`, never put a bare
  choice to the owner, write settled answers back into `profile/decision-log.md`
  (or the policy's `## Preferences` / `## Promoted rules` when the answer is a
  standing leaning or an axis that has now decided twice). The policy is read in
  full and capped at 12 promoted rules for that reason; the log is only grepped
  and has no limit (T-0242).
  Gated on the policy file existing, *not* on `secretary_enabled`. It is a
  handful of instruction tokens and no subagent, so charging it to a toggle
  whose stated cost is "a subagent per question" would be wrong — and the
  owner's preferences should shape how a question is phrased whether or not
  anyone is paying for a secretary.
- **secretary-agent** — consult the subagent, log DECIDE, file ESCALATE. Gated
  on `settings.secretary_enabled` in `~/.workhub/config.json`, along with
  `secretary-gate.mjs`, `secretary-consulted.mjs` and the OpenCode `ask_owner`
  tool. **The flag is off by default (T-0158), and a missing config or missing
  key counts as off**: hooks test `=== true`, never `!== false`, so a machine
  with no config never runs the secretary behind a Settings toggle that reads
  "off".

Keep the two harnesses aligned: `secretary-plugin.ts` splits the same way
(`profileRule` always, `secretaryRule` only when `secretaryOn`), and its
`tool.execute.after` handler must bail on `!secretaryOn` — otherwise it keeps
writing consulted-state for a gate that is not running.

Everything stays silent when the vault has no `profile/decision-policy.md`.
That note lives at the vault root rather than under `knowledge/` because it is
operational — hooks, skills and the agent all read it — and deleting it is the
documented way to turn the whole mechanism off by omission.

## The counsel is not the gate (T-0208)

Two things answer the owner in this vault, and merging them is the mistake to
avoid:

- **secretary** — a haiku subagent that judges *one question* and returns
  DECIDE or ESCALATE. Cheap, enforced by a hook, read-only, fixed output
  contract.
- **strategist** — a skill (`plugins/workhub/skills/strategist/`) that reviews
  the owner's direction against `strategy/`. It runs in the **main session**,
  never as a subagent.

`strategist` is deliberately not an agent, for three reasons that will each
come back if someone tries to convert it:

- **A subagent cannot hold a conversation.** It is invoked, reads, reports and
  exits. The value of a review is the back-and-forth, which can only happen
  where the owner is.
- **There is nothing to isolate.** `strategy/` is two north-star notes, two
  current notes and a handful of bottlenecks. The context-isolation argument
  that justifies `code-explore` does not apply at that size.
- **Two personas in one session read as neither.** The `persona` plugin owns
  the session voice; a subagent with its own character would have its words
  relayed by whatever character the main session is wearing.

The counsel's character therefore comes from `persona`, not from a copy in the
vault: `profile/strategist.md` carries a `persona:` key naming a character id,
and the skill calls `plugins/persona/scripts/persona-switch.mjs` to put it on
and take it off. That CLI exists because `/persona` is parsed out of the user's
own prompt by `persona-mode-tracker.mjs`, which a skill cannot reach — and
because that same hook re-asserts the active character every turn, so telling
the model to adopt a character without writing the flag loses within a few
turns.

Both couplings are optional by design. A vault with no `strategy/` and a setup
with no `persona` plugin both give the same counsel, unstyled — so neither the
skill nor the secretary may hard-depend on either.
