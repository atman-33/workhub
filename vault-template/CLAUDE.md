<!-- workhub-template: version=1 -->

# workhub vault

This Obsidian vault is the data store of the workhub app. It is the single
source of truth for tasks and knowledge shared between humans and AI agents.
The workhub desktop app, Obsidian, humans, and AI agents all read and write
the same files.

## Structure

| Folder | Zone | Contents |
|--------|------|----------|
| `tasks/` | human + AI | one task = one Markdown file with YAML frontmatter |
| `projects/` | human + AI | per-project notes and task deliverables |
| `knowledge/` | human + AI | shared knowledge (research results, collected info) |
| `templates/` | human | note templates (`task.md`) |
| `_ai/` | **AI only** | `index/` machine-readable indexes, `logs/` raw agent reports, `memory/` agent working memory |
| `attachments/` | human + AI | images and other binary assets |

English folder names are lowercase kebab-case.

## Task schema

Task files live flat in `tasks/`, named `<id> <title>.md` (e.g.
`T-0042 Improve sort order.md`). Frontmatter:

```yaml
id: T-0042          # assigned by the app, never change
title: ...
status: todo        # inbox | todo | doing | review | done
assignee: me        # me | claude-code | opencode
project: devdeck    # target project/repo identifier (optional)
priority: medium    # low | medium | high
order: 2            # manual sort position within the status column (number,
                    # may be fractional); managed by the app — leave as is
due: 2026-07-20     # optional
tags: []
created: 2026-07-10
updated: 2026-07-10
```

Body sections: `## Description` (task description — the prompt context for AI) and
`## Results` (results, filled on completion, links to deliverable notes).

## Agent harness

This vault is the **default working directory for AI agent sessions**
(Claude Code / OpenCode). Development work targets external repositories
registered in `.claude/project-context.json`; the vault itself holds tasks,
knowledge, and configuration — never application code.

- Skills, hooks, and agents come from Claude Code plugins.
  `.claude/settings.json` declares the `workhub-marketplace` (the workhub
  GitHub repo) and enables the required project-scope plugins (`workhub`,
  `engineering`). Toggle optional plugins (`scrum`, `obsidian`, `stack-*`)
  there or with `/plugin`. See `docs/plugins.md` in the workhub repo for the
  catalog and scope policy.
- **Never author skills inside this vault.** New skills belong in the
  workhub repo's `plugins/`; personal/machine tools go to the user-scope
  `productivity` plugin.
- `.opencode/skills/` (when present) is a generated artifact synced from the
  enabled Claude plugins — edit the plugin source and re-sync, never the
  copies.
- Respond to the user in Japanese. Write documents and repository artifacts
  in English unless the user explicitly requests otherwise.

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
- When updating a task file, change only `status`, `updated`, and the
  `## Results` section. Preserve all other frontmatter and body content.
- Raw work reports go to `_ai/logs/`. Polished, human-readable summaries and
  deliverables go to `projects/` or `knowledge/`, linked from the task's
  `## Results`.
- Read `_ai/index/tasks.json` first to find tasks; do not scan the whole
  vault. Fall back to reading `tasks/` frontmatter if the index is missing.
- Do not overwrite existing human-zone notes; append or create new notes and
  link them. `_ai/` is yours to manage freely.
