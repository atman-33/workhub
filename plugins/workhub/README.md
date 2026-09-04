# workhub plugin

Claude Code plugin for the [workhub](../../README.md) task board. Lets an AI
agent list, start, and report tasks stored as Markdown + frontmatter in the
workhub Obsidian vault.

## Skills

| Skill | Description |
|-------|-------------|
| `task-list` | List and filter tasks from the vault (via `_ai/index/tasks.json`, falling back to `tasks/` frontmatter) |
| `task-start` | Mark a task `doing`, load its body as working context, resolve the target repository |
| `task-report` | Record results: raw report to `_ai/logs/`, polished notes to `projects/`/`knowledge/`, update the task's `## Results` and set `status: review` |
| `vault-init` | Expand `vault-template/` into a new workhub vault |
| `kb-ingest` | Classify notes from `inbox/` into `projects/`/`knowledge/`/`archive/`, propose tasks for actionable items, link and index |
| `kb-query` | Search the vault and synthesize answers across notes, citing sources with wikilinks |
| `kb-lint` | Health check: orphan notes, broken links, index drift, tag issues, stale content |
| `kb-index` | Update the zone `_index.md` files (smart diff by default, `--full` rebuild) |
| `vault-migrate` | Migrate another Obsidian vault into the workhub vault — copy-only, with scripted delta-zero verification (user-invoked only) |
| `setup-project-context` | Scaffold or show `.claude/project-context.json` — the file the harness hooks below read (user-invoked only) |
| `setup-rules-ex` | Scaffold the `rules-ex` extended-rules infrastructure the `inject-extended-rules` hook reads (user-invoked only) |
| `capture-rule` | Route a durable insight to the rules home where it will auto-inject next time — a repo's `.claude/rules`, the harness's `rules-ex`, the harness's own rules, or auto-memory |

The last three live here rather than in `engineering` because every file they
write is read by this plugin's harness hooks: a setup step for a required
plugin must not sit inside an optional one. `engineering`'s `setup-all`
delegates to the first two.

## Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `profile-inject` | SessionStart | Inject the owner's `profile/decision-policy.md` and `about-me.md` |
| `harness/inject-project-context` | SessionStart | Inject the app's registered projects — see [Harness hooks](#harness-hooks) |
| `harness/inject-target-rules` | PreToolUse (Read/Edit/Write) | Inject a sibling repository's `CLAUDE.md` and `.claude/rules` |
| `harness/inject-extended-rules` | PreToolUse (Read/Edit/Write) | Inject the vault's `.claude/rules-ex` rules that target other repositories |
| `vault-write-guard` | PreToolUse (Write) | Refuse to overwrite an existing note in the vault's human zone |
| `secretary-gate` | PreToolUse (AskUserQuestion) | Consult the `secretary` agent before a question reaches the owner (off by default) |
| `secretary-consulted` | PostToolUse (Task) | Record that the secretary was consulted |
| `memory-inject` | UserPromptSubmit | Inject relevant long-term memory |
| `task-sync-reminder` | Stop | Remind to run `task-report` if a started task was left unreported |
| `memory-capture` | Stop | Save the session's chunks into the vault memory database |

## Vault contract

Skills follow the rules in the vault's `CLAUDE.md`: AI may only transition
`todo → doing → review` (never `done`), may only change `status`, `updated`,
and the `## Results` section of a task file, and must keep raw logs in `_ai/`.

The vault path is resolved in this order:

1. `WORKHUB_VAULT` environment variable
2. the current directory, when it is itself a vault (has `tasks/` and `_ai/`)
3. `vault_path` in `~/.workhub/config.json` (the pre-0.49
   `%APPDATA%\workhub\config.json` is still read as a fallback) — **but only
   while the current directory is inside that vault**

That last condition is what makes this plugin safe to install at user scope.
Its hooks run in every session on the machine, and the app's config resolves a
vault from anywhere; without the check, a session in an unrelated repository
would get the owner's profile injected, its prompts answered out of vault
memory, and its transcript captured into the vault database. Resolving to
nothing outside the vault makes every hook here no-op exactly as it does on a
machine with no vault at all.

The skills and the CLI scripts (`scripts/task-cli.mjs`, `scripts/comms-cli.mjs`,
`memory-engine/cli.mjs`) deliberately keep the unconditional fallback: an
explicit command should find the vault from wherever it is run.

## Harness hooks

`hooks/harness/` holds the three hooks that wire the workhub app to a session.
They came from the `engineering` plugin, and moving them is what let that plugin
stop being required: they are the only readers of the `.claude/project-context.json`
the app writes, so the app depends on *this* plugin and on nothing else.

Like every other hook here, they inject nothing when the file they read is
absent — a machine with no vault and no configured project sees no difference.

### SessionStart hook: project context injection

On every session start, the plugin injects a `<project-context>` XML block into
Claude's context containing your registered project paths and the openspec docs
folder. This mirrors the kind of "active project context" you may have wired up
manually with a `settings.json` hook, but ships with the plugin and works on both
Windows and WSL.

The hook is `node`-based, so it runs identically on Windows, WSL, and macOS with
no platform-specific wrapper. It reads a per-project config file and is silent
(injects nothing) when that file is absent — it never nags an unconfigured
project.

Whenever it does inject context, the exact injected block is also shown to you as
a `systemMessage` in the transcript, so you can confirm the intended context was
injected. (A missing config still shows nothing.)

#### Configuration

In a vault, the workhub app writes `.claude/project-context.json` itself from
the repositories registered in its **Repos** tab — there is nothing to do by
hand. Elsewhere, create it in the project root: copy
[`hooks/harness/project-context.example.json`](hooks/harness/project-context.example.json),
or run this plugin's `setup-project-context` skill.

```json
{
  "openspecPath": "C:/repos/workhub/openspec",
  "postToolFormatCommands": [
    "npm run format"
  ],
  "projects": [
    {
      "name": "workhub",
      "path": "C:/repos/workhub",
      "summary": "Claude Code plugin marketplace",
      "postToolFormatCommands": [
        "npm run format",
        "npm run lint -- --fix"
      ]
    },
    {
      "name": "my-app",
      "path": "C:/repos/my-app",
      "postToolFormatCommands": ["npm run format"]
    }
  ]
}
```

- `roleBasedDelegation`, `openspecPath`, `postToolFormatCommands`, and
  `projects` are all optional. Omit any and the relevant hook skips that part;
  a missing file injects nothing.
- `openspecPath` falls back to `<project-root>/openspec` when it is empty **or**
  points at a folder that does not exist, so switching projects rarely needs a
  manual path edit. If neither path exists, the `<openspec>` line is omitted.
  Use the `set-openspec-path` skill to switch it by picking a registered
  project from a menu instead of hand-editing the absolute path.
- `postToolFormatCommands` is read by the `engineering` plugin's PostToolUse
  hook, not by this one. It can be declared either at the top level (global
  default for all registered targets) or inside each `projects[]` entry
  (project-specific override). The per-project value wins when both are present.
  Commands run best-effort, sequentially, after Claude `Edit`/`Write`
  operations for files under a registered **target** project outside the
  current cwd. They run in that target project's root, and the hook emits a
  `systemMessage` showing exactly which commands ran and whether each one
  succeeded.
- `name` defaults to `path` when omitted; `summary` is optional.
- A sibling repo's own guidance (`CLAUDE.md`/`AGENTS.md` and `.claude/rules`) is
  injected lazily by the PreToolUse hook when you actually touch that repo's
  files — see [PreToolUse hook](#pretooluse-hook-target-repo-guidance-injection)
  below.
- `roleBasedDelegation: true` injects the role-based delegation criteria. That
  one is read by the `engineering` plugin, not this one — the criteria name
  its sub-agents, so they switch off together. Without `engineering`
  installed the key is simply ignored.

This produces:

```xml
<project-context>
  <openspec path="C:/repos/workhub/openspec" />
  <registered-projects>
    <project name="workhub" path="C:/repos/workhub">
      <summary>Claude Code plugin marketplace</summary>
    </project>
    <project name="my-app" path="C:/repos/my-app" />
  </registered-projects>
</project-context>
```

### PreToolUse hook: target-repo guidance injection

Claude Code only loads memory/rules from the current working directory hierarchy
(upward) plus cwd subdirectories. When you launch the harness in one repo and use
it to develop a **sibling** repo, that sibling's `CLAUDE.md`/`AGENTS.md` and
`.claude/rules/*.md` are never loaded — they live outside the cwd tree. A `node`-based hook
([`hooks/harness/inject-target-rules.mjs`](hooks/harness/inject-target-rules.mjs))
closes that gap by reproducing the native memory/rule loading for sibling repos.

On every `Read`, `Edit`, or `Write`, the hook resolves the touched file against
the registered projects in `.claude/project-context.json`. When the file lives
under a sibling project root (never the cwd itself — that guidance loads
natively), it injects three things via `additionalContext`:

1. **`<target-project-instructions>`** — the repo's root instruction file
   (`CLAUDE.md` preferred, else `AGENTS.md`), **full text**, injected at most once
   per session per repo. This replaces the old `instructions` path attribute on
   `<project-context>`: instead of just pointing Claude at the file, the content is
   loaded automatically the moment you touch the repo.
2. **`<target-project-rules>`** — the repo's `.claude/rules/*.md` whose `paths:`
   front matter glob-matches the touched file (rules without `paths` always
   apply). Each rule is injected at most once per session, so a path-scoped rule
   still injects the first time a matching file is touched, without re-injecting on
   every subsequent call.
3. **`<target-project-skills>`** — a catalog of the repo's
   `.claude/skills/<name>/SKILL.md`: name, description and path, one line each,
   injected once per session per repo. A hook cannot register a skill with the
   Skill tool, so the catalog tells Claude the skills exist and to read the
   `SKILL.md` when one applies. Skill bodies are never injected.

#### Nested repositories

Repositories nest. A full-stack repo may hold `frontend/` and `backend/` as
repositories of their own, with the cross-cutting guidance at the outer level and
the local guidance inside — and both apply. So the hook resolves a **chain**
rather than a single repo:

- every registered root that owns the touched file, **plus**
- any unregistered ancestor above the outermost of them that both is a repository
  (`.git`) and carries guidance (`CLAUDE.md`, `AGENTS.md` or `.claude/`), walking
  up at most three levels and stopping at the home directory and the drive root.

The chain is ordered outermost first, so the innermost, most specific guidance
lands closest to the request. The `.git` gate is what keeps a plain container
directory such as `C:/repos` out of the chain. Set `"ancestorRules": false` in
`.claude/project-context.json` to consider registered roots only.

De-duplication uses a temp-dir sentinel keyed by session and file. Whenever it
injects, the hook also surfaces a one-line `systemMessage` summary in the
transcript (e.g. `🔎 target-rules: full-stack-repo — CLAUDE.md (full) + rules:
monorepo.md + skills: deploy-stack | frontend — CLAUDE.md (full)`) so you can see
at a glance which repositories, instruction files, rules and skills were injected.
The full text only goes to Claude's context, not the transcript. The hook is
failure-tolerant and silent (injects nothing) for cwd-local files, unregistered
paths, or repos without the relevant files.

The matching logic lives in
[`hooks/harness/target-rules-core.mjs`](hooks/harness/target-rules-core.mjs)
(unit-tested in `target-rules-core.test.mjs`); the hook script itself only does
I/O. Its OpenCode mirror is `vault-template/.opencode/plugins/lib/project-context-core.ts`
in the workhub repo — a change to one side must land in both.

