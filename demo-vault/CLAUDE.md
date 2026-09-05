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
| `profile/` | human + AI | who the owner is (`about-me.md`), how they decide (`decision-policy.md` for the axes, `decision-log.md` for the individual calls) and which persona counsels them (`strategist.md`) — read by hooks, skills and the secretary agent |
| `strategy/` | human + AI | where the owner is heading (`north-star/`), where they are (`current/`) and what is blocking them (`bottlenecks/`) — read by `/strategist` |
| `inbox/` | human + AI | raw input landing zone — classify with `/kb-ingest` |
| `journal/` | human | daily/weekly notes — agents read but never ingest, move, or index |
| `archive/` | human + AI | completed or inactive material |
| `templates/` | human | note templates (`task.md`, `_index.md.template`, `project/` scaffold) |
| `_ai/` | **AI only** | `index/` indexes, `logs/` agent reports + KB activity log, `memory/` working memory |
| `attachments/` | human + AI | images and other binary assets |
| `.workhub/` | **app only** | `settings.json` — the app settings that belong to this vault (see below) |

`.workhub/settings.json` holds the app settings that describe *this vault*
rather than one machine — the AI's task language, the custom prompt, the
agent/model choices for schedule and mindmap edits, the recurring-task rules,
and the vault-tidy policy. It is version-controlled with the vault on purpose:
cloning the vault on another PC restores them. Machine-specific settings
(paths, command templates, hotkeys, window geometry) stay in that machine's
`~/.workhub/config.json` and are never written here. The app owns the file —
change these settings from its Settings dialog rather than by editing it.

English folder names are lowercase kebab-case. Topic folders under `knowledge/`
follow the same convention (e.g. `knowledge/infra/`).

## Working agreement

How agents and the owner work together here. It applies to every session in
this vault, on top of the task-specific prompt.

**Owner context.** `profile/` is who the owner is and how they decide.
`about-me.md` covers background, current work and where the rest of their
context lives; `decision-policy.md` covers what you may settle alone, what has
to come back to them, and — in its `## Preferences` and `## Promoted rules`
sections — the leanings you build a recommendation from. Read them before work
that depends on any of that, instead of asking the owner to restate it. It sits
at the vault root rather than under `knowledge/` because it is operational:
hooks, skills and the `secretary` agent all read it.

The policy is deliberately short — it is read in full on every question, so it
holds the *axes* of a decision and nothing else. The individual calls the owner
has settled live in `decision-log.md`, which has no size limit and is never
read whole: grep it when the policy does not settle a question and a similar
one may have come up before.

**Strategic context.** `strategy/` is where the owner is heading, not who
they are, which is why it sits beside `profile/` rather than inside it:
`north-star/` holds the mission, vision, values and the rules they will not
break; `current/` holds the honest present tense (active work, numbers,
capacity, and the quarter's roadmap); `bottlenecks/` holds what is stopping
them, one file per wall.

It is **not** injected into every session — a code change does not need it,
and paying for it every time would be waste. The `/strategist` skill loads it
when the owner wants to think out loud, and cross-checks the three against
each other. Read it yourself only when a task turns on the owner's priorities.

Nothing in `strategy/` duplicates a project: a project keeps its own plan in
`projects/<project>/roadmap.md` and `schedules/`, and
`strategy/current/roadmap.md` links to them rather than restating their dates.

**Questions carry a recommendation.** Never put an open choice to the owner.
Work out from the policy's `## Preferences` and `## Promoted rules` which answer
they would most likely give, and offer it as the recommended option with its
reason. When they settle a question, append the rule it establishes to
`decision-log.md`'s `## Decisions` — or to the policy's `## Preferences` when it
is a standing leaning, or to its `## Promoted rules` when the same reasoning has
now settled a second question — so the same question is not asked twice.

**Before building.** Write the plan before the implementation, and get it
approved when the task is plan-first. Reuse what already exists — an existing
note, module, or convention beats a new one. Prefer being handed the goal
(what, for whom, why) and working out the *how* yourself; when the goal is
unclear, ask for it rather than guessing at steps.

**In conversation.** Be a collaborator, not a yes-man. Ask about anything
ambiguous instead of picking an interpretation silently, and say so when a
request looks wrong, more expensive than it needs to be, or solvable a better
way. Disagree with reasons, then follow the owner's decision.

**Recording.** Write down what a future session would otherwise have to
rediscover, without being asked: decisions and the reasoning behind them,
options that were rejected and why, and ideas parked for later. Route it as
described in *Capturing knowledge* below — working notes for a session go to
`_ai/memory/`, design decisions to the project's `dev-notes/`, reusable
constraints to `.claude/rules/`. When something fails, record the cause and
what to do differently, so the next session does not repeat it.

**Safety.** Confirm with the owner before anything irreversible or outward
facing: deleting or overwriting files, force-pushing, rewriting history,
sending mail or messages, publishing, or spending money. Prefer the reversible
form (append, copy, new file, draft) when one exists. Approval for one action
is not approval for the next one.

The workhub app's **Settings → Commands → Custom prompt** is appended verbatim
to every task launch prompt; its whitespace collapses to single spaces, so keep
it to a short personal delta. Anything longer belongs in this file or in
`profile/about-me.md`, which agents read from the vault itself.

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
blocked: true       # optional; absent = false. Waiting on someone else. Kept
                    # separate from `status` on purpose — a task can be
                    # blocked in any column
blocked_note: waiting for the vendor quote
                    # optional; one line, only while blocked. The longer story
                    # belongs in the body
blocked_since: 2026-08-06
                    # optional; when the wait started, only while blocked. The
                    # board counts the days from it
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

## Project layout

Each development project gets one folder under `projects/<project-slug>/`
(English kebab-case). Start a new project by copying `templates/project/` and
filling in the placeholders. Layout:

| Path | Contents |
|---|---|
| `README.md` | Entry point — read first. Overview, current status, where things live, reading order, key links. Embeds the backlog Base. |
| `prd.md` | Product intent, scope, goals — the single source of product intent |
| `roadmap.md` | Milestones and schedule |
| `links.md` | Link collection — repos, environments, dashboards, design files, references. `README.md` keeps only the daily few and points here |
| `specs/` | Feature specs, one file per feature |
| `backlog/` | Backlog items (`B-NNN-<title>.md`), one per file; `_backlog.base` renders them by status/priority |
| `research/` | Investigations and technical spikes |
| `dev-notes/` | Development notes, design decisions, architecture |
| `deliverables/` | Task deliverable notes (`T-XXXX-<title>`), linked from a task's `## Results` |
| `schedules/` | Schedule notes (`<name>.md`), one per plan under consideration; read and written by the app's Schedule tab |
| `mindmaps/` | Mindmap notes (`<name>.md`), one per map; read and written by the app's Mindmap tab |
| `attachments/` | Images and binaries for this project |
| `_index.md` | Machine-readable index, maintained by `/kb-index` |

**AI agents: open `README.md` first.** It states the current status and points
to everything else — do not scan the whole project folder.

Folder names are English kebab-case; note file names may be Japanese (vault
convention). `B-NNN` is a stable identifier, not a sort order — ordering and
status live in frontmatter and are rendered by `_backlog.base`.

`_index.md` also carries an optional `repos:` key listing the registered
repositories this project belongs to — each entry an absolute path, or the
repository's name as it is registered in the app:

```yaml
repos:
  - C:/repos/workhub
  - C:/repos/workhub-vault
```

**The first entry is the project's default repository** — the one an agent
works in when the task does not say which. The link is stored rather than
inferred because a project folder and its repositories do not share a naming
scheme (the vault's `multi-agent-ff15` is the repository
`multi-agent-ff15-vscode`). The app's **Projects** tab reads and writes it,
including the order.

A project may legitimately span several repositories — an app and its vault,
or a frontend and a backend — which is why this is a list and not a single
key. The pre-T-0216 single `repo:` key is gone; it is not read as a fallback,
so a note that still carries it reads as having no repository at all.

A project that is finished or parked moves to `archive/projects/<slug>/` —
under `archive/projects/`, not `archive/<slug>/`, so the folder's origin
survives the move. The **Projects** tab archives and restores it; a project
folder is never deleted, because it holds months of hand-written prose.

### Schedule notes

`schedules/` holds the project's date planning. One file is one plan; copy it
to compare alternatives. The app's **Schedule** tab renders the file as a
continuous week grid and writes changes straight back, so the note stays
editable in Obsidian at the same time.

Frontmatter is flat (`type: schedule`, `title`, `range`, `created`,
`updated`); the content lives in two managed sections, plus a `## Memo`
section neither the app nor the AI ever rewrites:

```markdown
## Non-working

- weekly: sat, sun
- 2026-08-11 Mountain Day
- 2026-08-13..2026-08-15 summer leave

## Items

- [bar] I-001 2026-07-21..2026-08-07 implementation #blue task:T-0090
- [arrow] I-005 2026-07-21..2026-08-19 vendor lead time #gray
- [milestone] I-003 2026-08-20 release review #red
- [note] I-004 2026-07-31 monthly review 15:00
```

Element line: `- [<kind>] <id> <date-spec> <title> [#<color>] [task:<task-id>]`

- `<kind>` is `bar`, `arrow`, `milestone`, or `note`. A `bar` is a period that
  is settled; an `arrow` is the same span drawn as a thin double-headed line,
  for a period that is still an estimate (lead time, buffer, parallel work).
- `<id>` is `I-` + a number, unique in the file. **Never change or reuse one** —
  it is how the app and the AI identify an element across edits.
- `<date-spec>` is `YYYY-MM-DD..YYYY-MM-DD` for a `bar` or `arrow`, a single
  `YYYY-MM-DD` otherwise.
- `#<color>` is one of `blue`, `green`, `amber`, `red`, `purple`, `gray`.
- `task:<task-id>` links the element to a task in `tasks/`.
- An element may carry extra lines of text on **indented continuation lines**
  beneath it (ordinary Markdown list continuation). A `note` shows them on
  hover in the app; every other kind shows them in its tooltip.

```markdown
- [note] I-004 2026-07-31 monthly review
  15:00-16:00, room A
```

Non-working days drive the working-day counts the grid shows. Schedule
elements are **not** tasks: they are candidates under consideration, and
putting them on the board would break its meaning. A task appears on the
calendar through its own `due` date, or via a `task:` link.

### Mindmap notes

`mindmaps/` holds the project's idea maps. One file is one map; the app's
**Mindmap** tab renders it as a mindmap and writes changes straight back, so
the note stays editable in Obsidian at the same time.

Frontmatter is flat (`type: mindmap`, `title`, `created`, `updated`, and the
optional `node_width` / `stickies`); the content lives in two managed sections
— `## Nodes` and the optional `## Stickies` — plus a `## Memo` section neither
the app nor the AI ever rewrites:

```markdown
## Nodes

- N-001 workhub #blue
  - N-002 tasks #green task:T-0042
    - N-003 kanban ^collapsed
  - N-004 schedule #amber
    lead times are still guesses

## Stickies

- S-001 node:N-004 @96,24 #amber re-check the dates after the vendor call
```

Node line: `- <id> <title> [#<color>] [task:<task-id>] [^collapsed] [^left|^right]`

- Nesting is indentation, two spaces per level — an ordinary nested bullet
  list, which is what makes the file editable by hand.
- `<id>` is `N-` + a number, unique in the file. **Never change or reuse one** —
  it is how the app and the AI identify a node across edits. A node typed by
  hand without an id gets one the next time the app reads the file.
- `#<color>` is one of `blue`, `green`, `amber`, `red`, `purple`, `gray`. A
  branch inherits the nearest coloured ancestor's colour, so colour the branch
  head rather than every node.
- `task:<task-id>` links the node to a task in `tasks/`.
- `^collapsed` hides the node's children **in the app**; the subtree itself is
  untouched.
- `^left` / `^right` pins a branch to one side of the root (only meaningful on
  a child of a root). Without it, branches alternate by their position in the
  list. The app writes it whenever an action implies a side — adding a branch
  beside another, or dragging one across the root — so branches never swap
  sides while the map is being edited.
- A node may carry extra lines of text on **indented continuation lines**
  beneath it, which the app shows on hover.

Sticky line: `- <id> node:<node-id> @<dx>,<dy> [#<color>] [<text>]`

A sticky is a note pinned to a node and drawn on the map beside it — always
visible, unlike a node's own continuation lines, which only appear on hover.

- `<id>` is `S-` + a number, unique in the file. **Never change or reuse one.**
- `node:<node-id>` is required: it is what the sticky is pinned to. Deleting a
  node deletes its stickies.
- `@<dx>,<dy>` is an integer offset in pixels from the pinned node's **centre**
  to the sticky's top-left corner — the only coordinate in the file, and a
  relative one, so a sticky follows its node through any re-layout. Omitted, it
  defaults to `@32,24`.
- `#<color>` is from the same palette as a node's; absent means `amber`.
- Longer text continues on **indented continuation lines**, like a node's note.
- `## Stickies` goes between `## Nodes` and `## Memo`, and a map with no
  stickies carries no such section at all.
- The frontmatter key `stickies: hidden` hides every sticky on the map at once
  (the Mindmap tab's sticky button). It is a display setting; it hides them in
  the exports too, so a hand-out matches the screen.

Node positions are deliberately **not** stored: the app lays the map out from
the tree every time it draws it, anchored on the root — so collapsing a branch
re-flows that branch without moving the centre of the map. The tab's "mermaid"
button copies the map as a mermaid `mindmap` code block for pasting into a
document — that export is one-way, since mermaid cannot carry ids, colours or
task links.

`node_width` decides how wide the boxes are drawn, and is set from the picker
in the Mindmap tab. It belongs to the note rather than to the app because the
right answer differs per map, and because an export has to look like what was
on screen when it was made:

- `auto` (the default, written as the absence of the key) sizes every box to
  its own text;
- `siblings` gives the children of one parent a common width;
- `depth` gives every node at the same distance from the root a common width,
  which lines the map up in columns at the cost of one long title widening
  every box on its level.

### Backlog vs tasks

`backlog/` is the project's idea pool; `tasks/` (vault root) is the app's
single source of executable tasks. They are not the same list:

- A backlog item is a candidate (`status: idea | ready | dropped`). Keep it
  lightweight.
- When an item is `ready` and picked up, it becomes a real task in `tasks/`
  (created via the app). Record the task id back on the item
  (`promoted: T-XXXX`, `status: promoted`) so it drops out of the open view.
- Deliverables produced by that task land in the project's `deliverables/`,
  linked from the task's `## Results`.

## Agent harness

This vault is the default working directory for AI agent sessions
(Claude Code / OpenCode). Development work targets external repositories
registered in `.claude/project-context.json`; the vault itself holds tasks,
knowledge, and configuration — never application code.

- Skills, hooks, and agents come from Claude Code plugins.
  `.claude/settings.json` declares the `workhub-marketplace` (the workhub
  GitHub repo) and enables required project-scope plugins (`workhub`,
  `engineering`) plus `obsidian`. Toggle optional plugins (`team-ops`,
  `stack-*`) there or with `/plugin`. See `docs/plugins.md` in the workhub
  repo for the catalog and scope policy.
- **Personal skills may live in this vault** at `.claude/skills/<name>/SKILL.md`
  (agents at `.claude/agents/<name>.md`). The app's template only owns the paths
  listed in `_ai/template-manifest.json`, so these are never overwritten by an
  app update. See `.claude/skills/README.md`.
  The rule of thumb: **only you use it → vault; someone else would use it →
  promote it to a plugin** in the workhub repo's `plugins/` (rewritten in
  English), then delete the vault copy.
- `.opencode/skills/` (when present) is a generated artifact synced from the
  enabled Claude plugins and from this vault's own `.claude/skills/` — edit the
  source and re-sync, never the copies.
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
`setup-herdr` skill from the `agent-ops` plugin. If herdr is not installed,
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
to the right home (the workhub plugin's `capture-rule` skill does the
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

## Local instructions

`CLAUDE.local.md` at the vault root holds the owner's own instructions for
agents. The workhub app seeds it once and never updates it, which is exactly
why it exists: this file (`CLAUDE.md`) is app-managed and re-applied on every
app update, so anything written here would eventually be overwritten. Read
`CLAUDE.local.md` when it is present, and treat it as taking precedence over
this file. If it is missing or empty, there are simply no local instructions.

Anything an agent is asked to remember permanently goes there, never into this
file — see `.claude/rules/app-managed-files.md` for the full list of files the
app manages.

<important>
- Confirm with the owner before irreversible or outward-facing actions
  (deleting, overwriting, force-pushing, sending, publishing, spending).
- Never set a task's `status` to `done`. Only humans mark tasks done in the app.
- Never delete a worktree folder directly; always use `git worktree remove`.
- Personal skills may live in `.claude/skills/`; promote anything shared to a plugin.
- Respond to the user in Japanese; write repository artifacts in English.
- Never edit app-managed files (`CLAUDE.md`, `AGENTS.md`, `opencode.json`, and
  the `.claude/**` / `.opencode/**` paths listed in `_ai/template-manifest.json`)
  to record instructions — use `CLAUDE.local.md`. Unlisted paths such as
  `.claude/skills/` are yours.
</important>
