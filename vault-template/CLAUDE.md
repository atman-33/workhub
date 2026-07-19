<!-- workhub-template: version=2 -->

# workhub vault

This Obsidian vault is the data store of the workhub app and the owner's
personal knowledge base. Humans and AI agents read and write the same Markdown
files; it is the single source of truth for tasks and shared knowledge.

## Structure

| Folder | Zone | Contents |
|--------|------|----------|
| `tasks/` | human + AI | one task = one Markdown file with YAML frontmatter |
| `projects/` | human + AI | per-project notes and task deliverables |
| `knowledge/` | human + AI | durable reference knowledge, one topic folder per theme |
| `inbox/` | human + AI | raw input landing zone — classify with `/kb-ingest` |
| `journal/` | human | daily/weekly notes — agents read but never ingest, move, or index |
| `archive/` | human + AI | completed or inactive material |
| `templates/` | human | note templates (`task.md`, `_index.md.template`) |
| `_ai/` | **AI only** | `index/` indexes, `logs/` agent reports + KB activity log, `memory/` working memory |
| `attachments/` | human + AI | images and other binary assets |

English folder names are lowercase kebab-case. Topic folders under `knowledge/`
follow the same convention (e.g. `knowledge/infra/`).

## Knowledge workflow

Humans drop raw notes into `inbox/`; `/kb-ingest` classifies them into
`projects/` / `knowledge/` / `archive/`, proposes tasks for actionable items,
and maintains the zone `_index.md` files. `/kb-query` searches and synthesizes,
`/kb-lint` health-checks, `/kb-index` repairs indexes. The KB activity log is
`_ai/logs/kb-log.md`.

## Task schema

Active task files live flat in `tasks/`, named `<id> <title>.md` (e.g.
`T-0042 Improve sort order.md`); archived tasks are moved into the
`tasks/archive/` subfolder (same filename) to keep the flat listing tidy.
Frontmatter:

```yaml
id: T-0042          # assigned by the app, never change
title: ...
status: todo        # inbox | todo | doing | review | done
assignee: me        # me | claude-code | opencode
project: devdeck    # target project/repo identifier (optional)
priority: medium    # low | medium | high
model: sonnet       # optional; AI model passed as `--model` when the app
                    # launches an agent for this task. Absent = agent default.
order: 2            # manual sort position; managed by the app — leave as is
due: 2026-07-20     # optional
tags: []
archived: true      # optional; absent = false. Hidden from the board by
                    # default; the app files it under tasks/archive/
confirm: true       # optional; absent = false. Plan-first approval before executing
worktree: true      # optional; absent = false. Work in a dedicated git worktree
created: 2026-07-10
updated: 2026-07-10
```

Body sections, in document order:

| Section | Written by | Meaning |
|---------|-----------|---------|
| `## Description` | human | prompt/spec for AI — what should happen |
| `## Plan` | AI, approved by human | the approved implementation plan |
| `## Results` | AI, on completion | deliverables, links to deliverable notes |

Description and Plan are inputs; Results is the output. A non-empty `## Plan`
means the plan is already approved — follow it instead of re-planning. The
section outlives the session that wrote it, so a plan approved by one agent
can be executed later by another. The app renders Plan read-only; edit plans
in Obsidian.

## Agent harness

This vault is the default working directory for AI agent sessions
(Claude Code / OpenCode). Development work targets external repositories
registered in `.claude/project-context.json`; the vault itself holds tasks,
knowledge, and configuration — never application code.

- Skills, hooks, and agents come from Claude Code plugins.
  `.claude/settings.json` declares the `workhub-marketplace` (the workhub
  GitHub repo) and enables required project-scope plugins (`workhub`,
  `engineering`) plus `obsidian`. Toggle optional plugins (`scrum`,
  `stack-*`) there or with `/plugin`. See `docs/plugins.md` in the workhub
  repo for the catalog and scope policy.
- **Never author skills inside this vault.** New skills belong in the
  workhub repo's `plugins/`; personal/machine tools go to the user-scope
  `productivity` plugin.
- `.opencode/skills/` (when present) is a generated artifact synced from the
  enabled Claude plugins — edit the plugin source and re-sync, never the copies.
- Respond to the user in Japanese. Write documents and repository artifacts
  in English unless the user explicitly requests otherwise.
- **Exception:** a task file's `## Plan` and `## Results` follow the workhub
  **Task language** setting (default English), which the app states in its
  launch prompt. That setting governs those two sections only — never code,
  comments, commit messages, or repository documentation.

### herdr workspace integration

The workhub app can launch each AI task in a fresh [herdr](https://herdr.dev)
workspace. This is enabled by default in the app settings. To use it, install
herdr and its Claude Code / OpenCode integrations by running the
`setup-herdr` skill from the `productivity` plugin. If herdr is not installed,
the app automatically falls back to the configured terminal command.

### Git worktree mode

Set `worktree: true` in the task frontmatter to have the agent work in a
dedicated git worktree instead of the repository's main working tree. The
workhub app places worktrees in a `.worktrees/` folder at the same level as the
registered repositories. Relative to a repo root, the layout is:

```text
../.worktrees/<task-id>/<repo-name>
```

For example, from the repository root:

```bash
# create a new worktree and branch
git worktree add ../.worktrees/T-0042/workhub -b task/T-0042

# reuse an existing branch
git worktree add ../.worktrees/T-0042/workhub task/T-0042

# remove the worktree when it is no longer needed
git worktree remove ../.worktrees/T-0042/workhub
```

Do all task work inside the worktree path. If the worktree or branch already
exists (e.g. resuming a task), reuse it instead of recreating. Never delete the
worktree folder directly — that leaves stale git metadata. `task-report` offers
this cleanup when the task is finished.

For a multi-repo task, put each repo's worktree under the same
`.worktrees/<task-id>/` folder.

### Capturing knowledge

When investigation or implementation yields reusable knowledge that is
non-obvious from code, git history, or existing instruction files (gotchas,
build quirks, design invariants, conventions, the "why" behind a decision),
propose capturing it **at the moment of discovery** — do not defer. Route it
to the right home (the engineering plugin's `capture-rule` skill does the
mechanical authoring):

- **Target repo's `.claude/rules/<slug>.md`** — repo-specific technical
  knowledge; scope with repo-relative `paths:` so it auto-injects when
  relevant files are touched. Committed and shared with the team.
- **Vault `.claude/rules-ex/`** — cross-cutting knowledge that must reach
  target-repo files but lives in this vault (`paths:` required; globs are
  cwd-relative — see that folder's README for how to reach the repos from
  here).
- **Vault `.claude/rules/`** — knowledge about this vault harness's own
  machinery (grow `vault-harness.md`).
- **Vault `knowledge/`** — reference material humans also read (research
  results, collected information). Rule of thumb: constraints agents must
  *follow* are rules; information humans and agents *consult* is knowledge.
- **Auto-memory** — personal/cross-project preferences, feedback, or
  machine-local facts (not shared).

## Rules for AI agents

- **Status transitions you may perform:** `todo → doing → review` only.
  Never set `done` — a human does that in the app.
- When updating a task file, change only `status`, `updated`, the `## Plan`
  section (plan-first tasks, before implementation starts), and the
  `## Results` section. Preserve all other frontmatter and body content.
- Never rewrite an approved `## Plan` in place — it is the user's approval
  record. Append if the plan genuinely changes, and say so.
- Raw work reports go to `_ai/logs/`. Polished, human-readable summaries and
  deliverables go to `projects/` or `knowledge/`, linked from the task's
  `## Results`.
- Read `_ai/index/tasks.json` first to find tasks; do not scan the whole
  vault. Fall back to reading `tasks/` frontmatter if the index is missing.
- Do not overwrite existing human-zone notes; append or create new notes and
  link them. `_ai/` is yours to manage freely.

<important>
- Never set a task's `status` to `done`. Only humans mark tasks done in the app.
- Never delete a worktree folder directly; always use `git worktree remove`.
- Do not author skills inside this vault; keep skill source in the workhub repo.
- Respond to the user in Japanese; write repository artifacts in English.
</important>
