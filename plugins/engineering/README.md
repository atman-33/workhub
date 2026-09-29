# engineering

Engineering utilities and helpers for software development tasks.

## Components

### Skills

- `commit-changes`, `create-feature-branch`, `create-pull-request` — day-to-day git/PR workflow helpers. Releasing is deliberately absent: a release procedure is repository-specific — which files carry the version, whether a PR is involved, what publishes the build — so it belongs in that repository's `.claude/rules/`, plus a repository-specific skill where it needs driving (e.g. `workhub:release-app`).
- `create-review-guide` — generate a self-contained HTML code-review guide (overview, architecture diagram, file/class responsibility map, annotated change walkthrough). Output directory is set per machine in the skill's `config.json` (copy `config.example.json`).
- `create-manual-test-guide` — generate a self-contained HTML manual-testing guide (setup, test-flow diagram, scenarios with expected results, interactive pass/fail checklist with Markdown export). Output directory is set per machine in the skill's `config.json` (copy `config.example.json`).
- `create-onboarding-guide` — generate a self-contained HTML onboarding tour of a repository (architecture diagram, directory map, key flow walkthroughs, recommended reading order). Same per-machine `config.json` output-directory pattern as the other guide skills.
- `system-design` — settle a change with the user one interview round at a time, then write its design set into a folder they choose: `proposal.md`, one `spec-<capability>.md` per capability, `design.md` (decisions, risks, deferrable open questions) and `uml.md` (use case, ER, sequence and file change map diagrams in Mermaid). Documents only — it stops before implementation. Adapted from OpenSpec and mattpocock/skills; see `NOTICE.md`.
- `create-adr` — record an architecture decision as a numbered ADR in the target repo's `docs/adr/` (context, decision, alternatives, consequences).
- `investigate-bug-report` — diagnose a reported bug to its root cause with evidence (reproduce/trace, blast radius, fix candidates) without changing code.
- `setup-all` — run every project setup step in sequence. Both phases delegate to the `workhub` plugin's `setup-project-context` and `setup-rules-ex` skills, and are skipped with a note when that plugin is not installed.

`setup-all`
is explicit-invocation only (`disable-model-invocation: true`) — type the skill
name to run it.

Test-first development, codebase design, spec/ticket flows and plan grilling
used to live here as vendored copies of `mattpocock/skills` v1.0.1; they were
removed in favor of the upstream `mattpocock-skills` plugin
(`mattpocock-skills@claude-plugins-official`), which ships the current versions
(`tdd`, `codebase-design`, `to-spec`, `to-tickets`, `grill-with-docs`, …).
Install that plugin to keep those workflows.

### Sub-agents

One sub-agent (see `agents/`):

| Agent | Model | Role |
|-------|-------|------|
| `test-runner` | haiku | Run tests/build/lint and summarize the result |

It exists to keep a long test or build log out of the main context: the main
session gets the verdict and the failing lines, not the whole transcript.
Nothing tells Claude when to use it — its `description` is enough, and the main
session calls it when a run is worth isolating.

This plugin used to ship three more — `code-explore`, `implementer` and
`heavy-implementer` — plus a SessionStart hook (`inject-role-delegation`,
switched on by `roleBasedDelegation` in `.claude/project-context.json`) that
injected criteria for delegating work to them. All four were removed (T-0451):

- The injected criteria pushed every session towards delegation, which runs
  against Claude Code's own default of spawning a sub-agent only when asked,
  and they reached sessions that never touch code.
- Delegating an implementation makes the sub-agent re-read, from nothing, the
  context the main session already holds, and leaves the main session
  reporting on code it did not write. The cheaper model seldom pays for that.
- `code-explore` duplicated Claude Code's built-in `Explore` agent, which does
  the same job and ships with the tool.

A `roleBasedDelegation` key left in an existing `project-context.json` is
ignored.

### MCP servers

None. The `serena` and `context7` servers this plugin used to register now live
in their own plugins:

| Plugin | Server |
|--------|--------|
| [`mcp-serena`](../mcp-serena/README.md) | `serena` — semantic, symbol-aware code retrieval and editing. |
| [`mcp-context7`](../mcp-context7/README.md) | `context7` — up-to-date library/framework documentation lookup. |

They were split out because plugin enable/disable is Claude Code's only
granularity for an MCP server: bundled here, neither could be switched off
without also losing this plugin's skills and sub-agents — and Serena in
particular is heavy (it pulls a Python toolchain and language servers) and can
fail to start for reasons that have nothing to do with engineering workflow.
They are two plugins rather than one for the same reason: turning Serena off
should not take context7 with it.

Nothing in this plugin requires either server.

### The shared config: `.claude/project-context.json`

This plugin's PostToolUse hook reads `.claude/project-context.json` in the project
root — the file the workhub app writes, and the one the `workhub` plugin's
`setup-project-context` skill scaffolds. The `workhub` plugin reads the same
file: it owns the `<project-context>` injection and the sibling-repository rule
injection, which are documented in
[that plugin's README](../workhub/README.md#harness-hooks). They moved there
because they are the sole readers of a file the app writes, and keeping them
here made `engineering` impossible to switch off.

What this plugin still reads from that file: `postToolFormatCommands` and
`projects[]` — see [PostToolUse hook](#posttooluse-hook-target-project-formatting).

### PostToolUse hook: target-project formatting

When you launch Claude Code in one working directory (for example the workhub
vault) and edit a
registered sibling repo, that sibling repo's own Claude hook config does not run.
The engineering plugin closes that gap with a `PostToolUse` hook
([`hooks/scripts/post-format-project.mjs`](hooks/scripts/post-format-project.mjs))
that reads `postToolFormatCommands` from `.claude/project-context.json`.

On every `Edit` or `Write`, the hook resolves the touched file against the
registered `projects[].path` roots. If the file belongs to a registered target
project **outside** the current cwd tree, it runs each configured command in that
target project's root. Per-project command lists override the top-level default.

- Commands run sequentially, in order.
- Failures are best-effort only: the hook never blocks the main Claude flow.
- The hook emits a `systemMessage` such as `🎨 post-format: my-repo` followed by
  `ok` / `fail` lines for each command, so you can verify exactly what ran.
- Files under the current cwd tree are skipped intentionally. This hook is for
  target-project formatting when you are developing outside the launcher repo.

Use this for formatter or fixer commands that are safe to run repeatedly from the
repo root, for example `npm run format`, `pnpm exec prettier --write`, or
`cargo fmt`.

#### How install scope relates to the config

Plugin files (including the hook script) live in the Claude Code plugin cache and
are referenced via `${CLAUDE_PLUGIN_ROOT}` — they are **not** copied into your
project, so there is nothing to commit from the plugin itself. The only
project-local file is `.claude/project-context.json`, which you create per
project. Install the plugin at `user` scope — the default — so the hooks are
available from any directory; they inject nothing where no config exists.
`project` scope is there for sharing the plugin with one repo's collaborators.

#### Windows / WSL note

Paths in `project-context.json` are injected verbatim. Windows and WSL use
different absolute-path forms (`C:/repos/...` vs `/mnt/c/repos/...`). If you run
Claude Code in both environments against the same repository, set the values to
match the environment you launch from (or keep separate configs).

#### Requirements

- Node.js on `PATH` (the hooks in this plugin are `node`-based).
