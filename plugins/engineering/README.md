# engineering

Engineering utilities and helpers for software development tasks.

## Components

### Skills

- `capture-rule`, `commit-changes`, `create-feature-branch`, `create-pull-request` — day-to-day git/PR workflow helpers. Releasing is deliberately absent: a release procedure is repository-specific — which files carry the version, whether a PR is involved, what publishes the build — so it belongs in that repository's `.claude/rules/`, plus a repository-specific skill where it needs driving (e.g. `workhub:release-app`).
- `create-review-guide` — generate a self-contained HTML code-review guide (overview, architecture diagram, file/class responsibility map, annotated change walkthrough). Output directory is set per machine in the skill's `config.json` (copy `config.example.json`).
- `create-manual-test-guide` — generate a self-contained HTML manual-testing guide (setup, test-flow diagram, scenarios with expected results, interactive pass/fail checklist with Markdown export). Output directory is set per machine in the skill's `config.json` (copy `config.example.json`).
- `create-onboarding-guide` — generate a self-contained HTML onboarding tour of a repository (architecture diagram, directory map, key flow walkthroughs, recommended reading order). Same per-machine `config.json` output-directory pattern as the other guide skills.
- `create-adr` — record an architecture decision as a numbered ADR in the target repo's `docs/adr/` (context, decision, alternatives, consequences).
- `investigate-bug-report` — diagnose a reported bug to its root cause with evidence (reproduce/trace, blast radius, fix candidates) without changing code.
- `develop-small-feature` — implement a small, well-scoped feature/fix end-to-end (branch → TDD → static checks → user verification → commit → PR).
- `setup-openspec` — install the OpenSpec CLI and run `openspec init --tools claude`.
- `setup-project-context` — scaffold or show `.claude/project-context.json` (see below).
- `set-openspec-path` — switch `openspecPath` by picking a registered project from a menu (see below).
- `setup-all` — run all of the setup skills above in sequence.
- `setup-rules-ex` — scaffold the `rules-ex` extended-rules infrastructure. The hook that reads it lives in the [`workhub` plugin](../workhub/README.md#harness-hooks); this skill only sets the folder up.

`develop-small-feature`, `setup-openspec`, `setup-project-context`,
`set-openspec-path`, `setup-all`, and `setup-rules-ex` are explicit-invocation
only (`disable-model-invocation: true`) — type the skill name to run them.

### Sub-agents

Role-based sub-agents (see `agents/`) so each kind of work runs in its own
context on a model matched to its cost and difficulty. Models are fixed in each
agent's frontmatter:

| Agent | Model | Role |
|-------|-------|------|
| `code-explore` | sonnet | Broad, read-only code investigation / reference tracing |
| `implementer` | sonnet | Implement settled, mostly-mechanical changes |
| `heavy-implementer` | sonnet | Large / multi-file implementation or debugging |
| `test-runner` | haiku | Run tests/build/lint and summarize the result |

The main session decides when to delegate. To make those criteria available to
Claude automatically, enable delegation-criteria injection (below).

### MCP servers

The plugin ships an `.mcp.json` that registers two MCP servers:

| Server | Role |
|--------|------|
| `serena` | Semantic code retrieval / editing toolkit ([oraios/serena](https://github.com/oraios/serena)), run via `uvx`. |
| `context7` | Up-to-date library/framework documentation lookup ([@upstash/context7-mcp](https://github.com/upstash/context7)). |

Each server is started through a small Node launcher under
[`mcp/`](mcp/) that is referenced via `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "serena":   { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/serena-mcp-launcher.mjs"] },
    "context7": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/context7-mcp-launcher.mjs"] }
  }
}
```

#### Why launcher scripts?

The two environments need different invocations (Windows calls `uvx` directly;
WSL/Linux runs it inside a login shell so PATH/uv resolve), and a static
`.mcp.json` can't branch on platform. Each launcher does that branch at runtime
via `process.platform`, so **one `.mcp.json` works on both Windows and WSL**.

#### Requirements

- **Node.js** on `PATH` (already required by the other components).
- **serena**: [`uv`/`uvx`](https://docs.astral.sh/uv/) on `PATH`. On WSL it must
  resolve in a login shell (`bash -l`). First launch pulls Serena from git and
  may take a while.
- **context7**: nothing extra — it falls back to `npx -y @upstash/context7-mcp`
  (slower first run). Install globally to speed startup:
  `npm i -g @upstash/context7-mcp`. No API key is required.

After installing/reloading the plugin, confirm both servers connect with `/mcp`.

### The shared config: `.claude/project-context.json`

Two of this plugin's hooks read `.claude/project-context.json` in the project
root — the file the workhub app writes, and the one the `setup-project-context`
skill scaffolds. The `workhub` plugin reads the same file: it owns the
`<project-context>` injection and the sibling-repository rule injection, which
are documented in [that plugin's README](../workhub/README.md#harness-hooks).
They moved there because they are the sole readers of a file the app writes, and
keeping them here made `engineering` impossible to switch off.

What this plugin still reads from that file:

- `roleBasedDelegation` — see below. It stayed here because the criteria it
  injects name this plugin's own sub-agents, so it has to switch off with them.
- `postToolFormatCommands` and `projects[]` — see
  [PostToolUse hook](#posttooluse-hook-target-project-formatting).

### SessionStart hook: role-based delegation criteria

Setting `"roleBasedDelegation": true` in `.claude/project-context.json` makes
[`hooks/scripts/inject-role-delegation.mjs`](hooks/scripts/inject-role-delegation.mjs)
inject a `<role-based-delegation>` block describing
**when to delegate and which sub-agent to use** (the `code-explore`,
`implementer`, `heavy-implementer`, and `test-runner` agents above). This is the
plugin-friendly equivalent of importing a delegation-criteria doc into your
`CLAUDE.md`: the criteria are loaded at session start without you having to edit
`CLAUDE.md`.

The criteria text lives in [`hooks/role-based-model-selection.md`](hooks/role-based-model-selection.md)
and is injected verbatim. The flag is opt-in, so sessions stay lean unless you
ask for it — consistent with the hook's "never nag an unconfigured project"
behavior. Enable it where you actually run multi-step development work (e.g. at
`user` scope, or per repo).

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

- Node.js on `PATH` (already required by the `setup-openspec` skill).
