---
paths:
  - ".claude/**"
  - ".opencode/**"
---

# Vault harness internals (maintainer notes)

These notes load only while editing the vault's own harness machinery (the
`paths` above). Grow this file as the harness evolves.

- Skills, hooks, agents, and MCP launchers come from Claude Code plugins
  (workhub repo `plugins/`, declared in `.claude/settings.json`). Plugins
  cannot ship `.claude/rules` — the rules in this folder and `rules-ex/` are
  the only harness pieces that live in the vault itself.
- `.claude/rules-ex/` is a custom extension powered by the
  `engineering@workhub-marketplace` plugin's `inject-extended-rules` hook;
  without that plugin enabled nothing in it is injected.
- `.opencode/skills/` (when present) is a generated artifact synced from the
  enabled Claude plugins — never hand-edit the copies.
- The engineering plugin's serena MCP launcher pins Python 3.11; if serena
  fails with an OpenSSL error, check that the launcher still passes
  `--python 3.11` (not 3.12+).
