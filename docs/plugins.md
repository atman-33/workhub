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
| `workhub` | **Required** | project (vault) | Task-board skills (`task-list`, `task-start`, `task-report`, `vault-init`, `vault-setup`), schedule editing (`schedule-edit` — rewrites `projects/<slug>/schedules/*.md` from a natural-language instruction; launched by the app's Schedule tab), mindmap editing (`mindmap-edit` — rewrites `projects/<slug>/mindmaps/*.md` from a natural-language instruction; launched by the app's Mindmap tab), vault knowledge-base skills (`kb-ingest`, `kb-query`, `kb-lint`, `kb-index` — they own the vault's inbox/projects/knowledge/archive layout), long-term memory (`memory-setup`, `memory-recall` + capture/inject hooks backed by the bundled `memory-engine/`), the `strategist` skill (a counsel that reads `strategy/` — the owner's north star, present state and bottlenecks — argues with the gaps between them, and writes the conclusions back; it borrows a character from `persona` when that plugin is installed and runs unstyled when it is not), the workhub app's own release procedure (`release-app` — bump, changelog, tag, push, verify the published assets), and vault write-guard / task-sync hooks. Meaningless outside a vault. |
| `engineering` | **Required** | project | Development workflow: role-based sub-agents, rule-injection hooks (`project-context.json`, `rules-ex`), serena/context7 MCP launchers, and skills (commit, PR, ADR, TDD, codebase design, bug investigation, review/test/onboarding guides, PRD/issues, …). Releasing is deliberately not here — a release procedure is repository-specific, so it belongs in that repository's `.claude/rules/` plus a repository-specific skill (e.g. `workhub`'s `release-app`). |
| `productivity` | **Required** | **user** | Personal/machine tools: work logs, herdr/zellij setup, team launch, sidekick/handoff, Slack posting, README/CLAUDE.md/release-notes authoring, HTML reports, proposal deck preparation (`prepare-proposal-deck`, `draft-deck`), Zenn blog writing (`zenn-blog-writing`, `zenn-markdown`), and skill-writing helpers (`grilling`, `handoff`, `writing-great-skills`). No vault or project-context dependency. |
| `team-ops` | Optional | project | Team operations on a shared folder as SSoT: team knowledge base, file-based backlog + sprints, multi-repo dev-main tracking, daily burndown/spec reporting. Needs `.claude/team-context.json` (see `plugins/team-ops/docs/design.html`). |
| `obsidian` | Optional (pre-enabled in the vault template) | project or user | Generic Obsidian format helpers (Obsidian Flavored Markdown, Bases, JSON Canvas, Obsidian CLI, defuddle). Vault-agnostic — useful in the workhub vault and any other vault. |
| `persona` | Optional | project or user | Switchable response personas over a shared token-reduction engine. Bundled characters (`genshijin`, `noctis`, `lunafreya`, `ignis`) live in the plugin; user-defined ones live in `~/.claude/personas/` so they survive plugin updates. Three compression levels, persisted across sessions in `~/.claude/persona.json`. Character-agnostic subskills (commit, review, compress, stats, crew), three compressed-output subagents, and the `persona-shrink` MCP proxy. `scripts/persona-switch.mjs` lets another skill switch character for a session and switch back (this is how `workhub`'s `strategist` puts on `ignis`); it writes the same session flag `/persona` does, which is what makes the switch survive the per-turn reminder. A character is treated as an identity rather than a costume: descriptions are first-person, the per-turn reminder names the character, and `core/boundaries.md` tells an agent to answer to that name — with one deliberate exception, that a sincere question about being an AI is answered honestly. The workhub app’s **Persona** tab reads these same characters and writes `persona.json`; it hides itself when the plugin is absent. Derived from genshijin (MIT). No vault or project-context dependency — install at either scope. Do not enable alongside the standalone genshijin plugin; both inject per-turn style instructions. |
| `stack-cloudflare` | Optional | project | Cloudflare (Workers, Pages, R2, D1) development helpers. |
| `stack-dnd-kit` | Optional | project | dnd-kit drag-and-drop UI helpers. |
| `stack-opencode` | Optional | project | OpenCode configuration and extension helpers. |
| `stack-react-router` | Optional | project | React Router / Remix helpers. |

`stack-*` plugins are toggled per vault/project depending on the tech stack of
the active target repositories.

Adding a persona character is a `persona` concern, not a marketplace one: `/persona-new <id>` writes to `~/.claude/personas/<id>/character.md`, outside the
plugin directory, because plugins are unpacked per version and anything written
inside `plugins/persona/characters/` would not carry across an update.

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
claude plugin install team-ops@workhub-marketplace --scope project
claude plugin install obsidian@workhub-marketplace   # user scope for non-workhub vaults; the vault template already enables it at project scope
claude plugin install stack-react-router@workhub-marketplace --scope project
```

Re-run `claude plugin marketplace add atman-33/workhub` any time to pick up a
new plugin version (or use `claude plugin marketplace update
workhub-marketplace`). Toggle plugins for an existing vault with `/plugin`
inside a session, or by editing `.claude/settings.json` directly.

### One marketplace name, one source form

Never declare the same marketplace name in both source forms. Claude Code
accepts either the GitHub form (`{"source": "github", "repo":
"atman-33/workhub"}`) or the git URL form (`{"source": "git", "url":
"https://github.com/atman-33/workhub.git"}`), but if the name is registered
under one form in `~/.claude/settings.json` and under the other in
`~/.claude/plugins/known_marketplaces.json`, the marketplace is ignored
wholesale — every plugin it provides silently disappears.

Neither form is better than the other; only the mismatch breaks things. The
vault template declares the marketplace in the GitHub form, so register it the
same way at user scope — `claude plugin marketplace add atman-33/workhub` —
and never add it again as a `.git` URL.

The error messages do not point at the real cause. Symptoms look like:

```text
Plugin "workhub" not cached
Failed to update: Plugin "workhub" is not installed
```

To diagnose:

1. Run `claude plugin marketplace list` and check whether the marketplace is
   listed at all. If it is missing, this is the conflict.
2. Compare the `source` form for that name in `~/.claude/settings.json`
   (`extraKnownMarketplaces`) against `~/.claude/plugins/known_marketplaces.json`,
   and make them match.
3. While recovering, also check that the plugin still has an entry in
   `~/.claude/plugins/installed_plugins.json`, and whether
   `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.orphaned_at`
   exists — the sweep adds that marker once it treats the cached plugin as an
   orphan.

## OpenCode

OpenCode cannot consume Claude Code plugins directly. The vault's
`.opencode/skills/` is treated as a **generated artifact**: a sync script
materializes skills from the enabled Claude plugins, records hashes in a
manifest, and a session-start reminder plugin reports drift (missing / stale /
diverged / orphan). Never hand-edit synced skills on the OpenCode side; edit
the plugin source here and re-sync. (The tooling lives in
`vault-template/.opencode/scripts/`, ported from workhub's predecessor
repository.)
