---
name: vault-setup
description: Set up a machine to work with a workhub vault - check/install required software (git, Node.js, Claude Code, OpenCode), initialize the vault if needed, wire up Claude plugins, and run the OpenCode sync scripts. Use when onboarding a new machine, after a fresh vault-init, or when the harness feels half-configured.
argument-hint: "[vault-path]"
---

# vault-setup — Prepare a machine for a workhub vault

End-to-end environment setup: software → vault → Claude harness → OpenCode
sync → verification. Steps that are already satisfied are skipped; nothing is
installed without telling the user first.

## 1. Resolve the vault path

1. Use the argument if given.
2. Else `WORKHUB_VAULT` env var, then `vault_path` in
   `%APPDATA%\workhub\config.json` (`~/.config/workhub/config.json` off
   Windows).
3. If none resolves, ask the user where the vault is (or should be created).

## 2. Check required software

Probe each tool and collect what is missing (do not install yet):

| Tool | Check | Needed for |
|---|---|---|
| git | `git --version` | repos, plugin marketplace fetch |
| Node.js ≥ 20 | `node --version` | `.opencode/scripts/*.mjs` sync scripts |
| Claude Code | `claude --version` | the primary agent harness |
| OpenCode | `opencode --version` | optional second agent; skip if unused |
| Obsidian | Windows: `Test-Path "$env:LOCALAPPDATA\Obsidian"` | optional, human vault editing |
| herdr | `herdr --version` | optional, the default AI-task workspace launcher |

Present the missing list with the exact install commands and ask before
running any of them:

- Windows: `winget install Git.Git`, `winget install OpenJS.NodeJS.LTS`,
  `npm install -g @anthropic-ai/claude-code`, `npm install -g opencode-ai`,
  `winget install Obsidian.Obsidian`
- macOS/Linux: the same npm installs; git/node via the platform's package
  manager.
- herdr: install via the `setup-herdr` skill (productivity plugin) rather than
  a package manager — see Phase 6.

Obsidian, OpenCode, and herdr are optional — offer, don't push.

## 3. Ensure the vault exists

- If the resolved path is missing or empty, run the `vault-init` skill with
  that path (it copies `vault-template/` and registers the vault in the app
  config), then continue here.
- If the path exists but lacks `.claude/settings.json` or `.opencode/`, it
  predates the current template — suggest the `vault-migrate` skill instead
  of patching files ad hoc.

## 4. Claude Code harness

1. The vault's `.claude/settings.json` already declares the
   `workhub-marketplace` and enables the required project-scope plugins
   (`workhub`, `engineering`). Tell the user: on the first `claude` launch
   inside the vault, accept the marketplace/plugin trust prompt.
2. One-time per machine, install the user-scope plugin:
   `claude plugin install productivity@workhub-marketplace`
3. Remind the user to register target repositories in
   `.claude/project-context.json` (`projects[]` with `name`/`path`).

## 5. OpenCode sync (skip if OpenCode is not used)

Run from the vault root, and report each script's copied/skipped/missing
output:

```bash
node .opencode/scripts/sync-claude-skills.mjs        # project-scope plugin skills -> .opencode/skills/
node .opencode/scripts/sync-claude-user-plugins.mjs  # user-scope plugins -> global OpenCode command/skills
node .opencode/scripts/check-claude-plugin-sync.mjs  # verify nothing is stale
```

Add `--force` to the sync scripts only when the user asks to overwrite
existing targets. For WSL-against-Windows setups, set `CLAUDE_PLUGINS_ROOT`
and `OPENCODE_GLOBAL_ROOT` first (see
`.opencode/commands/sync-claude-user-plugins.md` in the vault).

## 6. Optional extras

- **herdr**: the workhub app launches AI tasks in a fresh herdr workspace by
  default. If the user wants that flow, run the `setup-herdr` skill from the
  `productivity` plugin; otherwise launches fall back to a plain terminal.
- **Obsidian**: open the vault folder as an Obsidian vault.

## 7. Verify and report

- `claude plugin list` inside the vault shows `workhub` and `engineering`.
- `<vault>/_ai/index/tasks.json` exists (open the workhub app once, or run
  the `task-list` skill to trigger a scan).
- If OpenCode is used, `check-claude-plugin-sync.mjs` reports clean.
- Summarize what was installed, what was skipped, and any manual follow-ups
  (trust prompt, project-context.json entries).
