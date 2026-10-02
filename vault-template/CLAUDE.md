# workhub vault

This Obsidian vault is the data store of the workhub app and the owner's
personal knowledge base. Humans and AI agents read and write the same Markdown
files; it is the single source of truth for tasks and shared knowledge.

This file is loaded in every session, so it holds only what applies to every
session. Format details live in `.claude/rules/` and load when a matching path
is touched: `tasks.md`, `projects.md`, `backlog.md`, `schedules.md`,
`mindmaps.md`, `shared-space.md`.

## Structure

| Folder | Zone | Role |
|--------|------|------|
| `tasks/` | human + AI | one task = one Markdown file; archived ones in `tasks/archive/` |
| `projects/` | human + AI | `NNNN-<slug>/` per project, one backlog item per unit of work |
| `knowledge/` | human + AI | the owner's reference material, one topic folder per theme; nothing injects it |
| `memory/` | human + AI | everything durable an agent knows (see Working agreement) |
| `strategy/` | human + AI | `north-star/` (where they head), `current/` (where they are), `bottlenecks/` (what blocks them); `/strategist` reads it |
| `inbox/` | human + AI | raw input; classify with `/kb-ingest` |
| `journal/` | human | agents read it, and leave it where it is |
| `archive/` | human + AI | completed or inactive material |
| `templates/` | human | note templates, including the `project/` scaffold |
| `_ai/` | **AI only** | working data: `index/`, `logs/` (agent reports, `kb-log.md`), `comms/`, `state/`. Knowledge belongs in `memory/` |
| `.workhub/` | **app only** | `settings.json`, the settings that describe this vault; change them in the app's Settings dialog |

Folder names are lowercase kebab-case, topic folders under `knowledge/`
included.

## Working agreement

How agents and the owner work together here, on top of the task prompt.

**Owner context.** `memory/identity/` holds who the owner is
(`about-me.md`) and how they decide (`decision-policy.md`: what you may settle
alone, what comes back to them, and the `## Preferences` and
`## Promoted rules` you build a recommendation from). Read it before work that
depends on any of that. The calls already settled are `type: decision` notes in
`memory/notes/`; search them when the policy leaves a question open.

**Memory.** `identity/` is read in full every session, so it stays capped.
`notes/` is searched, so each note carries a `type:`. `episodes/` decays and is
promoted from. A constraint about particular code goes in a `.claude/rules/`
file, which fires on a path.

**Recommend, don't ask openly.** Present every open choice with the answer the
owner would most likely give, derived from `## Preferences` and
`## Promoted rules`, and the reason. When they settle it, append the rule to
`decision-log.md`'s `## Decisions` (a standing leaning goes to `## Preferences`;
a second question settled by the same reasoning goes to `## Promoted rules`).

**Plan first.** Write the plan before the implementation, and get it approved
when the task is plan-first. Reuse an existing note, module or convention.
Take the goal (what, for whom, why) and work out the *how*; ask for the goal
when it is unclear.

**Follow-up tasks.** A task filed mid-session runs in a fresh session. Recommend
continuing here only for a small change that leans on context no note records,
and let the owner decide. The `task-handoff` skill carries the criteria.

**Collaborate.** Ask about anything ambiguous, and say so when a request looks
wrong, costlier than needed, or solvable a better way. Give the reasons, then
follow the owner's decision.

**Record.** Write down what a future session would otherwise rediscover:
decisions with their reasoning, rejected options, parked ideas, and the cause
of any failure with what to do differently. Session working notes go to
`_ai/state/`, design decisions to the project's `dev-notes/`.

**Safety.** Confirm with the owner before anything irreversible or outward
facing: deleting or overwriting files, force-pushing, rewriting history,
sending, publishing, spending. Prefer the reversible form (append, copy, new
file, draft). Approval for one action covers that action only.

The app's **Settings → Agents → Custom prompt** is appended to every task launch
prompt with whitespace collapsed, so it is a short personal delta. Longer
guidance goes in this file or `memory/identity/about-me.md`.

## Knowledge workflow

Humans drop raw notes into `inbox/`; `/kb-ingest` classifies them into
`projects/` / `knowledge/` / `archive/`, proposes tasks for actionable items,
and maintains the zone `_index.md` files. `/kb-query` searches and synthesizes,
`/kb-lint` health-checks, `/kb-index` repairs indexes. The activity log is
`_ai/logs/kb-log.md`.

## Tasks

A task is `tasks/<id> <title>.md` with YAML frontmatter (`id`, `title`,
`status`, `assignee`, `project`, `backlog`, `priority`, `confirm`, `worktree`,
`depends_on`, ...). The full schema loads from `.claude/rules/tasks.md` when you
open a task file; `task-cli` and the app write it.

Body sections, in order: `## Description` (human: the spec), `## Plan` (AI,
approved by human), `## Results` (AI, on completion). Description and Plan are
inputs, Results is the output. A non-empty `## Plan` is already approved: follow
it, and append to it when it genuinely changes.

## Projects and backlog items

A project is `projects/NNNN-<slug>/`. `NNNN` only orders the folder; the slug is
what `project:` keys use. Find a folder with the glob `projects/*-<slug>/` (or
`archive/projects/*-<slug>/`). Open its `README.md` first: it states the status
and points to everything else.

**Every task with a project has a backlog item.** A task without a `project` is
vault housekeeping: its output goes to `_ai/logs/` or `knowledge/`. An empty
`backlog` means "not chosen yet", and `task-start` settles it:

- Compare each item's `## What` with the task's `## Description`.
- Attach the task to an overlapping item. Start a new item only when none
  overlaps (or the project has none yet): a misfiled note is one move to fix,
  while a duplicate item splits a subject unnoticed.
- Write `backlog: B-NNN` onto the task and name the chosen item in your first
  message.

A recurring task keeps no item: it is a habit, and leaves nothing durable. The
item format loads from `.claude/rules/backlog.md`, and the layout from
`.claude/rules/projects.md`, when you work under `projects/`.

## Agent harness

This vault is the default working directory for AI agent sessions
(Claude Code / OpenCode). Development work targets external repositories
registered in `.claude/project-context.json`; the vault holds tasks, knowledge
and configuration.

- Skills, hooks and agents come from Claude Code plugins. `.claude/settings.json`
  declares the `workhub-marketplace`; plugins are switched on per machine from
  the app's **Plugins** tab or `/plugin`, and only `workhub` is required. The
  catalog and scope policy are in `docs/plugins.md` in the workhub repo.
- Personal skills live at `.claude/skills/<name>/SKILL.md` and agents at
  `.claude/agents/<name>.md`; template updates leave them alone. A skill someone
  else would use is promoted to a plugin in the workhub repo's `plugins/`.
- `.opencode/skills/` is generated from the enabled plugins and the vault's own
  skills; edit the source and re-sync.
- Respond in the workhub **Language** setting (⚙ Settings → Agents); the app
  injects a reminder every turn. The same setting governs a task's `## Plan` and
  `## Results`. Code, comments, commit messages and repository documentation are
  English.

### Session names

A session working a task is named so the session list reads at a glance:

```text
[<project>] <task-id> <title>     e.g. [workhub] T-0541 Session naming convention
<task-id> <title>                 when the task has no `project`
```

- `<project>` is the task's `project` slug as written, without the folder
  number. Keep it whole; truncate only the title, to 40 characters.
- Brackets, not `|`, `:` or `/`: those are special in shells and Windows paths,
  and a session name ends up in workspace labels and transcript file names.
- The app's herdr launch and the `task-handoff` chip already use this form.
  `task-start` renames a session that does not follow it when the host allows
  (Claude Desktop's `set_session_title`); OpenCode and a bare terminal cannot be
  renamed, so there the convention only applies to what the app launches.

### Worktrees

Work in the repository's main working tree. A task with `worktree: true` works
in `<worktree-root>/<task-id>/<repo-name>` on branch `task/<task-id>`; the
launch prompt names the root (the app's **Worktree root** setting), and
`task-start` step 5 has the commands. Create a worktree only for such a task,
and ask the owner first in any other case, including to keep clear of parallel
work. Remove one with `git worktree remove`, so git's metadata stays consistent.

### Capturing knowledge

Propose capturing reusable, non-obvious knowledge (gotchas, build quirks,
design invariants, the "why" behind a decision) at the moment you find it. The
`capture-rule` skill picks the home and writes it: a target repo's
`.claude/rules/` for repo-specific technical knowledge, the vault's
`.claude/rules-ex/` for cross-cutting knowledge that must reach repo files,
`knowledge/` for reference humans also read, auto-memory for personal
preferences.

## Rules for AI agents

- Move a task's status `todo → doing → review`; the owner sets `done` in the
  app.
- Start a task only when its `depends_on` predecessors are `done`. `task-cli
  start` refuses otherwise and lists them: tell the owner, and leave `--force`
  to them.
- Change only `status`, `updated`, `## Plan` (plan-first tasks, before
  implementation) and `## Results` in a task file; preserve the rest.
- Append to an approved `## Plan` and say so; it is the owner's approval
  record.
- Raw work reports go to `_ai/logs/`. Polished summaries and deliverables go to
  the task's backlog item or `knowledge/`, linked from `## Results`.
- Find tasks through `_ai/index/tasks.json`, falling back to `tasks/`
  frontmatter if the index is missing.
- Append to or create-and-link human-zone notes. `_ai/` is yours to manage.

## Local instructions

`CLAUDE.local.md` at the vault root holds the owner's own instructions. The app
seeds it once and never updates it, and it takes precedence over this file; no
file, or an empty one, means there are none. This file is app-managed and
re-applied on every update, so anything an agent is asked to remember
permanently goes in `CLAUDE.local.md`. The full list of app-managed files is in
`.claude/rules/app-managed-files.md`.

<important>
- Confirm with the owner before irreversible or outward-facing actions
  (deleting, overwriting, force-pushing, sending, publishing, spending).
- Never set a task's `status` to `done`; the owner does that in the app.
- Remove a worktree with `git worktree remove`; deleting its folder leaves
  stale git metadata.
- Respond in the workhub **Language** setting; write repository artifacts in
  English.
- Record instructions in `CLAUDE.local.md`. This file, `AGENTS.md`,
  `opencode.json` and the `.claude/**` / `.opencode/**` paths listed in
  `_ai/template-manifest.json` are app-managed. Unlisted paths such as
  `.claude/skills/` are yours.
</important>
