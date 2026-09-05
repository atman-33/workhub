---
paths:
  - "CLAUDE.md"
  - "AGENTS.md"
  - "opencode.json"
  - ".claude/**"
  - ".opencode/**"
  - ".workhub/**"
---

# App-managed files (do not edit)

Parts of this vault are **owned by the workhub app**, not by the vault. They
are copied from the app's bundled template and re-applied whenever the app
updates, so an edit made here is either silently replaced or turned into a
conflict the owner has to resolve by hand.

`_ai/template-manifest.json` lists every managed path (its `files` keys). The
usual ones are `CLAUDE.md`, `AGENTS.md`, `opencode.json`, and everything under
`.claude/` and `.opencode/`.

`.workhub/settings.json` is app-owned too, though it arrives by a different
route: the app writes it from its Settings dialog rather than copying it from
the template. It carries the settings that belong to this vault (task
language, custom prompt, schedule/mindmap agent choices, recurring rules,
tidy policy) so a second machine gets them from git. Never hand-edit it to
change how agents behave — the running app will write its own values back
over yours.

**Rules for agents**

- Never edit a managed file to record instructions, preferences, or project
  conventions. Write them where they belong instead:
  - `CLAUDE.local.md` — standing instructions for agents in this vault. Never
    managed by the app; it is yours.
  - `profile/about-me.md` — facts about the owner.
  - `profile/decision-policy.md` — the axes the owner decides on, and the
    preferences a recommendation is built from.
  - `profile/decision-log.md` — the individual calls they have settled.
  - the target repository's `.claude/rules/` — repo-specific technical rules.
- If a managed file genuinely needs to change, the fix belongs upstream in the
  workhub repo's `vault-template/`. Say so and ask the owner rather than
  patching the vault's copy.
- A `<name>.new` file beside a managed file is the app's copy of an update it
  did not dare apply. Leave it alone; the owner resolves it from the app's
  template-update dialog.
