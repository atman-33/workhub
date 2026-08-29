---
paths:
  - "CLAUDE.md"
  - "AGENTS.md"
  - "opencode.json"
  - ".claude/**"
  - ".opencode/**"
---

# App-managed files (do not edit)

Parts of this vault are **owned by the workhub app**, not by the vault. They
are copied from the app's bundled template and re-applied whenever the app
updates, so an edit made here is either silently replaced or turned into a
conflict the owner has to resolve by hand.

`_ai/template-manifest.json` lists every managed path (its `files` keys). The
usual ones are `CLAUDE.md`, `AGENTS.md`, `opencode.json`, and everything under
`.claude/` and `.opencode/`.

**Rules for agents**

- Never edit a managed file to record instructions, preferences, or project
  conventions. Write them where they belong instead:
  - `CLAUDE.local.md` — standing instructions for agents in this vault. Never
    managed by the app; it is yours.
  - `knowledge/profile/about-me.md` — facts about the owner.
  - the target repository's `.claude/rules/` — repo-specific technical rules.
- If a managed file genuinely needs to change, the fix belongs upstream in the
  workhub repo's `vault-template/`. Say so and ask the owner rather than
  patching the vault's copy.
- A `<name>.new` file beside a managed file is the app's copy of an update it
  did not dare apply. Leave it alone; the owner resolves it from the app's
  template-update dialog.
