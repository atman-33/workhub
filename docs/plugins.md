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

Every plugin is classified on two axes: its **tier** (required / recommended /
optional) and **user scope vs project scope**.

The tier answers one question — *what breaks without it?*

- **required**: an app feature or an agent launch stops working. Exactly one
  plugin qualifies. `workhub` is named directly in the app's own launch prompts
  (`task-start`, `task-report`, `/kb-ingest`), owns the skills the Schedule and
  Mindmap tabs run, and its `hooks/harness/` scripts are the sole readers of the
  `.claude/project-context.json` the app writes — without them the repositories
  registered in the app never reach an agent at all.
- **recommended**: nothing breaks, but the harness is noticeably worse. A tab
  that explains its own absence (`persona`) belongs here, not above it. So does
  `engineering`: how a team commits, branches and reviews is that team's own
  call, and switching those conventions off must not take the app with them.
  That is why the app-coupled hooks moved out of it and into `workhub`.
- **optional**: a matter of taste or of which tech stack a repository uses.

Scope answers a different question — *where do you want to switch it on?* — and
the default answer is **user**:

- **User scope** (installed once per machine, `claude plugin install` with no
  flag): available from any working directory, and one toggle in the app's
  **Plugins** tab or in `/plugin` turns it on and off. This is the default for
  everything, including plugins that need a vault or a project config: needing
  something is not a reason to be installed narrowly.
- **Project scope** (enabled in one repository's `.claude/settings.json`): for a
  plugin that would be actively wrong outside that one repository. Nothing in
  this marketplace currently is, which is why no entry below is `project` only.

**Gating is the plugin's own job.** A user-scope plugin's hooks run in every
session on the machine, so a hook that depends on a vault, a
`project-context.json` or a `team-context.json` must no-op when that file is
absent — and, where it finds the file through machine-level config rather than
through the cwd, must also check that the session is actually inside the thing
that config describes. `workhub`'s `hooks/lib.mjs` is the worked example: it
accepts the app's configured vault only while the cwd is inside it, so a session
in an unrelated repository gets no profile injection, no memory injection and no
transcript captured into the vault database. A hook that cannot gate itself does
not get user scope.

**Placement rule for new skills:** put a skill in the plugin whose *use* it
shares — `workhub` for the vault, the task board and the app; `engineering` for
the development workflow; `authoring`, `agent-ops`, `claude-tooling` or `zenn`
for personal tools. A dependency on the vault or on project context is not by
itself a reason to pick a different plugin, and never a reason to reach for
project scope.

**How the user-scope plugins are cut.** By what is needed together in one
session, not by subject. That is why `agent-ops` holds eight skills (they all
presuppose a multiplexer) and `zenn` holds two: Zenn writing never co-occurs
with the other three, so a separate plugin keeps its guides out of every other
session. A skill is not a plugin — split further only when a group turns out
to be loaded for work that never uses it.

**Before a skill is a plugin at all:** a skill only its author will ever run
does not need one. It can live in the vault at `.claude/skills/<name>/SKILL.md`
(agents at `.claude/agents/<name>.md`), where the app's template never touches
it — `_ai/template-manifest.json` lists the managed paths one by one and those
are not among them. Prototyping there is cheaper than shaping a plugin around a
workflow that has run twice. Promote it once someone else would use it: rewrite
it in English under `plugins/<plugin>/skills/`, register the plugin here if it
is new, then delete the vault copy. `.opencode/scripts/sync-claude-skills.mjs`
mirrors vault-local skills into `.opencode/skills/` alongside the plugin ones,
listing them as `(vault-local)`; on a name collision the plugin wins and the
sync warns.

Note: the OpenSpec workflow itself is **not** bundled here — it is an
independent OSS project distributed via its own package/plugin install, not
something this marketplace needs to maintain.

## Plugin catalog

The tier and scope of every plugin below are also carried machine-readably in [`.claude-plugin/catalog.json`](../.claude-plugin/catalog.json),
which is what the workhub app's **Plugins** tab reads — Claude Code itself never
looks at that file. It deliberately holds no `version`, `description` or
`author`: each plugin's own `plugin.json` remains the single source for those.
The table here and that file must agree; `src/lib/plugin-catalog.test.ts` fails
CI when they drift, so a plugin added, removed or re-classified has to be
changed in both.

| Plugin | Tier | Scope | Contents |
|---|---|---|---|
| `workhub` | **Required** | user or project | Task-board skills (`task-list`, `task-start`, `task-report`, `vault-init`, `vault-setup`), project onboarding (`project-start` — the project-level counterpart of `task-start`: reads `projects/<slug>/README.md` first, follows its reading order only as far as the request needs, resolves the project's `repos:`, and reports goal / status / source / work in flight; read-only), schedule editing (`schedule-edit` — rewrites `projects/<slug>/schedules/*.md` from a natural-language instruction; launched by the app's Schedule tab), mindmap editing (`mindmap-edit` — rewrites `projects/<slug>/mindmaps/*.md` from a natural-language instruction; launched by the app's Mindmap tab), vault knowledge-base skills (`kb-ingest`, `kb-query`, `kb-lint`, `kb-index` — they own the vault's inbox/projects/knowledge/archive layout), long-term memory (`memory-setup`, `memory-recall` + capture/inject hooks backed by the bundled `memory-engine/`), the `strategist` skill (a counsel that reads `strategy/` — the owner's north star, present state and bottlenecks — argues with the gaps between them, and writes the conclusions back; it borrows a character from `persona` when that plugin is installed and runs unstyled when it is not), the workhub app's own release procedure (`release-app` — bump, changelog, tag, push, verify the published assets), vault write-guard / task-sync hooks, and the harness hooks in `hooks/harness/` (`inject-project-context` — the sole reader of the `.claude/project-context.json` the app writes; `inject-target-rules` and `inject-extended-rules` — the sibling-repository CLAUDE.md and `rules-ex` injection Claude Code does not do on its own), together with the three skills that write what those hooks read: `setup-project-context`, `setup-rules-ex` and `capture-rule`. Hooks and skills came from `engineering`, which stopped being required the moment they left it — a setup step for a required plugin cannot sit inside an optional one, which is exactly what made `rules-ex` unusable for a team that switches the development workflow off. Meaningless outside a vault, and every hook here gates on finding one. |
| `engineering` | Recommended | **user** | Development workflow: role-based sub-agents (`code-explore`, `implementer`, `heavy-implementer`, `test-runner`), the `inject-role-delegation` hook that injects the criteria for using them, `post-format-project`, serena/context7 MCP launchers, and skills (commit, PR, branch, ADR, TDD, codebase design, bug investigation, review/test/onboarding guides, PRD/issues, …). Recommended rather than required because commit messages, branch names and review flow are a team's own conventions, and a team on different ones should be able to switch this off without breaking the app — which is why the app-coupled rule-injection hooks, and the `setup-project-context` / `setup-rules-ex` / `capture-rule` skills that feed them, now live in `workhub`. `setup-all` stays here and delegates to the first two, skipping them with a note when `workhub` is absent. The delegation hook stayed here on purpose: it reads the same `project-context.json`, but the criteria it injects name the sub-agents above, so disabling this plugin has to take them with it. Releasing is deliberately not here — a release procedure is repository-specific, so it belongs in that repository's `.claude/rules/` plus a repository-specific skill (e.g. `workhub`'s `release-app`). |
| `claude-tooling` | Recommended | **user** | Extending and maintaining Claude Code itself: `create-claude-command`, `writing-great-skills`, `install-skill`, `manage-desktop-routines`, and `grilling` (stress-testing a plan — the tool you reach for while shaping what a command or skill should do). Carries the `SessionStart` plugin-update notice, which reports outdated plugins across every marketplace. That notice was why this plugin used to be required; the app's **Plugins** tab now answers the same question — for every registered marketplace since T-0238, not just this one — in one place and without a session, so it is a recommendation rather than a dependency. No vault or project-context dependency. |
| `authoring` | Optional | user | Writing text deliverables and handing them over: `create-readme`, `create-claude-md`, `create-release-notes`, `create-work-log`, and `post-to-slack` as the delivery step. Visual deliverables moved to `visuals`: `draft-deck` and `prepare-proposal-deck` both stopped at a prompt for an external design tool, and `generate-html-report` emitted HTML with no design system behind it, so all three were removed rather than left competing with a skill that renders the thing here. No vault or project-context dependency. |
| `visuals` | Optional | user | Visual deliverables as self-contained HTML, and the PDF that gets handed over: `html-deck` (a presentation on a fixed 16:9 stage — content and timing first, three real style previews, generation, browser verification for overflow and overlap), `html-diagram` (inline SVG on an editorial grammar — eight types, six mandatory connector rules, a 9-node budget, and `self-check.mjs` for the accessible-SVG contract, single-file safety and diagonal connectors), `html-doc` (explainer, one-pager, report, dashboard, comparison) and `html-to-pdf` (headless Chromium; `--mode page` paginates a document by its `@page` CSS, `--mode slides` captures a deck one slide per page, which print CSS cannot do properly — it emits portrait pages with every inactive slide blank). `shared/` carries the design system and the single-file skeleton so the rules are written once rather than per skill. Derived from four MIT upstream projects — see `plugins/visuals/NOTICE.md`. Optional because it is a matter of what you produce, not of the harness working; kept separate from `authoring` because the two share no rules, only a verb. Playwright is installed on first use into `~/.workhub/visuals-playwright`, never into the project. No vault or project-context dependency. |
| `agent-ops` | Optional | user | Running agents in a terminal multiplexer, and the setup behind it: `setup-herdr`, `setup-zellij`, `herdr`, `handoff`, `handoff-go`, `launch-team`, `sidekick-go`, `wsl-vscode-doctor`. Kept as one plugin because every skill here presupposes a multiplexer that can split panes and spawn agents — splitting them would separate `handoff-go` from the herdr it drives. The workhub app launches AI tasks into a herdr workspace by default, so `setup-herdr` is usually the first thing a new machine runs. No vault or project-context dependency. |
| `zenn` | Optional | user | Zenn tech-blog writing: `zenn-blog-writing` (house style) and `zenn-markdown` (Zenn-flavoured syntax). Two skills, kept separate deliberately: they are needed only on the days an article is written and never alongside the other three plugins, which is exactly when a separate plugin earns its keep. No vault or project-context dependency. |
| `strategy` | Optional | project or user | Turning a strategy handed down from above into your own organization's target states: `strategy-decompose` (take in the upper strategy, close the unknowns with the owner, decompose it into aspects and states, audit, output an xlsx) plus the `strategy-auditor` agent, which checks a decomposition for necessity, sufficiency and overlap from a context other than the one that wrote it. Ships `build_xlsx.py` / `read_xlsx.py` so the workbook shape does not drift between runs. No vault or project-context dependency. |
| `team-ops` | Optional | user or project | Team operations on a shared folder as SSoT: team knowledge base, file-based backlog + sprints, multi-repo dev-main tracking, daily burndown/spec reporting. Needs `.claude/team-context.json` (see `plugins/team-ops/docs/design.html`). |
| `obsidian` | Optional | project or user | Generic Obsidian format helpers (Obsidian Flavored Markdown, Bases, JSON Canvas, Obsidian CLI, defuddle). Vault-agnostic — useful in the workhub vault and any other vault. |
| `persona` | Recommended | project or user | Switchable response personas over a shared token-reduction engine. Bundled characters (`holmes`, `genshijin`, `noctis`, `lunafreya`, `ignis`) live in the plugin — `holmes` doubles as the worked example of a character file written entirely in English;  user-defined ones live in `~/.claude/personas/` so they survive plugin updates. Three compression levels, persisted across sessions in `~/.claude/persona.json`. Character-agnostic subskills (commit, review, compress, stats, crew), three compressed-output subagents, and the `persona-shrink` MCP proxy. `scripts/persona-switch.mjs` lets another skill switch character for a session and switch back (this is how `workhub`'s `strategist` puts on `ignis`); it writes the same session flag `/persona` does, which is what makes the switch survive the per-turn reminder. A character is treated as an identity rather than a costume: descriptions are first-person, the per-turn reminder names the character, and `core/boundaries.md` tells an agent to answer to that name — with one deliberate exception, that a sincere question about being an AI is answered honestly. The workhub app’s **Persona** tab reads these same characters and writes `persona.json`; it is always shown, and with no characters found it explains what is missing and hands over a paste-ready setup prompt instead of a character list. It also warns when a cached `genshijin` plugin is sitting alongside `persona`. Derived from genshijin (MIT). No vault or project-context dependency — install at either scope. Do not enable alongside the standalone genshijin plugin; both inject per-turn style instructions. Recommended rather than required: the Persona tab is the only thing that depends on it, and that tab is built to be shown with the plugin absent (T-0215) — nothing else in the app changes. |
| `stack-cloudflare` | Optional | user or project | Cloudflare (Workers, Pages, R2, D1) development helpers. |
| `stack-dnd-kit` | Optional | user or project | dnd-kit drag-and-drop UI helpers. |
| `stack-opencode` | Optional | user or project | OpenCode configuration and extension helpers. |
| `stack-react-router` | Optional | user or project | React Router / Remix helpers. |

`stack-*` plugins are toggled depending on the tech stack you are actually
working in. Leave them at user scope and switch them on and off from the
**Plugins** tab; reach for `--scope project` only when a stack belongs to one
repository and you never want its guidance anywhere else.

Adding a persona character is a `persona` concern, not a marketplace one: `/persona-new <id>` writes to `~/.claude/personas/<id>/character.md`, outside the
plugin directory, because plugins are unpacked per version and anything written
inside `plugins/persona/characters/` would not carry across an update.

## Setup summary

Per machine, once. `vault-template/.claude/settings.json` declares the
marketplace via `extraKnownMarketplaces` (GitHub `atman-33/workhub`) but enables
no plugins: a plugin is switched on per machine, not per vault, so a fresh vault
carries the marketplace and nothing else. Turn the plugins you want on from the
app's **Plugins** tab — the toggle writes `~/.claude/settings.json` — or with
`/plugin` inside a session. Claude Code installs them on the next launch.

The same setup can be done ahead of time from a terminal (no Claude Code
session needed), using the non-interactive `claude plugin` CLI:

```powershell
# one-time per machine: register the marketplace (user scope)
claude plugin marketplace add atman-33/workhub

# every install below is user scope, which is the default (no --scope flag)

# required
claude plugin install workhub@workhub-marketplace

# recommended
claude plugin install engineering@workhub-marketplace
claude plugin install claude-tooling@workhub-marketplace
claude plugin install persona@workhub-marketplace

# optional, as needed
claude plugin install authoring@workhub-marketplace
claude plugin install agent-ops@workhub-marketplace
claude plugin install zenn@workhub-marketplace
claude plugin install obsidian@workhub-marketplace
claude plugin install team-ops@workhub-marketplace
claude plugin install stack-react-router@workhub-marketplace

# --scope project only for a plugin you want in one repository and nowhere else
claude plugin install stack-cloudflare@workhub-marketplace --scope project
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
