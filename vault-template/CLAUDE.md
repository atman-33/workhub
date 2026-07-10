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
due: 2026-07-20     # optional
tags: []
created: 2026-07-10
updated: 2026-07-10
```

Body sections: `## 内容` (task description — the prompt context for AI) and
`## 結果` (results, filled on completion, links to deliverable notes).

## Rules for AI agents

- **Status transitions you may perform:** `todo → doing → review` only.
  Never set `done` — a human does that in the app.
- When updating a task file, change only `status`, `updated`, and the
  `## 結果` section. Preserve all other frontmatter and body content.
- Raw work reports go to `_ai/logs/`. Polished, human-readable summaries and
  deliverables go to `projects/` or `knowledge/`, linked from the task's
  `## 結果`.
- Read `_ai/index/tasks.json` first to find tasks; do not scan the whole
  vault. Fall back to reading `tasks/` frontmatter if the index is missing.
- Do not overwrite existing human-zone notes; append or create new notes and
  link them. `_ai/` is yours to manage freely.
