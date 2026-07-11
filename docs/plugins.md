# workhub plugin marketplace

The workhub repository is the single source of Claude Code plugins for the
workhub vault harness. The vault created from `vault-template/` is the default
working directory for AI agent sessions (Claude Code / OpenCode); plugins
provide all reusable skills, hooks, agents, and MCP launchers so that the vault
itself carries only configuration — never skill copies.

Plugins were migrated here from the now-deprecated `atman-marketplace`
repository. The marketplace manifest lives at
[`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json).

## Scope policy

Every plugin is classified on two axes: **required vs optional** and
**user scope vs project scope**.

- **Project scope** (enabled in the vault's `.claude/settings.json`): anything
  that depends on the current working directory being the vault — reads
  `.claude/project-context.json`, the vault folder structure, or per-project
  configuration. Required project-scope plugins are pre-enabled by
  `vault-template/.claude/settings.json`, so creating a vault *is* the setup.
- **User scope** (installed once per machine via `claude plugin install`):
  personal, machine-level tools that are useful from any working directory and
  have no dependency on the vault or project context.

**Placement rule for new skills:** if a skill needs the vault, the
project-context config, or a target repository resolved through them, it
belongs in a project-scope plugin (`engineering`, `workhub`, or a new one). If
it is a personal/machine tool, it belongs in `productivity` (user scope). When
a productivity skill grows a project-scope dependency, move it out of
`productivity` at that point.

Note: the OpenSpec workflow itself is **not** bundled here — it is an
independent OSS project distributed via its own package/plugin install, not
something this marketplace needs to maintain.

## Plugin catalog

| Plugin | Required | Scope | Contents |
|---|---|---|---|
| `workhub` | **Required** | project (vault) | Task-board skills (`task-list`, `task-start`, `task-report`, `vault-init`, `vault-setup`), vault knowledge-base skills (`kb-ingest`, `kb-query`, `kb-lint`, `kb-index` — they own the vault's inbox/projects/knowledge/archive layout), and vault write-guard / task-sync hooks. Meaningless outside a vault. |
| `engineering` | **Required** | project | Development workflow: role-based sub-agents, rule-injection hooks (`project-context.json`, `rules-ex`), serena/context7 MCP launchers, and skills (commit, PR, ADR, TDD, codebase design, bug investigation, review/test/onboarding guides, PRD/issues, …). |
| `productivity` | **Required** | **user** | Personal/machine tools: work logs, herdr/zellij setup, team launch, sidekick/handoff, Slack posting, README/CLAUDE.md/release-notes authoring, HTML reports, Zenn blog writing (`zenn-blog-writing`, `zenn-markdown`), and skill-writing helpers (`grilling`, `handoff`, `writing-great-skills`). No vault or project-context dependency. |
| `scrum` | Optional | project | Scrum workflows against monday.com and Google Drive (backlog, sprint review, retrospective). Needs per-project `scrum-context.json`. |
| `obsidian` | Optional (pre-enabled in the vault template) | project or user | Generic Obsidian format helpers (Obsidian Flavored Markdown, Bases, JSON Canvas, Obsidian CLI, defuddle). Vault-agnostic — useful in the workhub vault and any other vault. |
| `stack-cloudflare` | Optional | project | Cloudflare (Workers, Pages, R2, D1) development helpers. |
| `stack-dnd-kit` | Optional | project | dnd-kit drag-and-drop UI helpers. |
| `stack-opencode` | Optional | project | OpenCode configuration and extension helpers. |
| `stack-react-router` | Optional | project | React Router / Remix helpers. |

`stack-*` plugins are toggled per vault/project depending on the tech stack of
the active target repositories.

## Setup summary

Per vault: nothing to do. `vault-template/.claude/settings.json` declares the
marketplace via `extraKnownMarketplaces` (GitHub `atman-33/workhub`) and
enables the required project-scope plugins (`workhub`, `engineering`) — on the
first Claude Code launch inside the vault, accept the trust prompt and the
plugins install themselves.

The same setup can be done ahead of time from a terminal (no Claude Code
session needed), using the non-interactive `claude plugin` CLI:

```powershell
# one-time per machine: register the marketplace (user scope)
claude plugin marketplace add atman-33/workhub

# required plugins
claude plugin install workhub@workhub-marketplace --scope project
claude plugin install engineering@workhub-marketplace --scope project
claude plugin install productivity@workhub-marketplace   # user scope (default)

# optional plugins, as needed
claude plugin install scrum@workhub-marketplace --scope project
claude plugin install obsidian@workhub-marketplace   # user scope for non-workhub vaults; the vault template already enables it at project scope
claude plugin install stack-react-router@workhub-marketplace --scope project
```

Re-run `claude plugin marketplace add atman-33/workhub` any time to pick up a
new plugin version (or use `claude plugin marketplace update
workhub-marketplace`). Toggle plugins for an existing vault with `/plugin`
inside a session, or by editing `.claude/settings.json` directly.

## OpenCode

OpenCode cannot consume Claude Code plugins directly. The vault's
`.opencode/skills/` is treated as a **generated artifact**: a sync script
materializes skills from the enabled Claude plugins, records hashes in a
manifest, and a session-start reminder plugin reports drift (missing / stale /
diverged / orphan). Never hand-edit synced skills on the OpenCode side; edit
the plugin source here and re-sync. (The tooling lives in
`vault-template/.opencode/scripts/`, ported from workhub's predecessor
repository.)
