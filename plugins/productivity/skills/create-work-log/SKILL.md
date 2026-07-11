---
name: create-work-log
description: Compose a daily or weekly work log from git activity across the user's configured repositories and save it as Markdown (e.g. into an Obsidian vault). Use when the user asks for a work log, daily report, weekly summary, 日報/週報, or "what did I do today/this week".
allowed-tools: Read Glob Grep Write Bash(git *)
---

# Create Work Log

Turn real git activity into a readable work log — Markdown, because the
destination is typically an Obsidian vault or a chat paste, not a browser.

## 1. Resolve config

Read `config.json` next to this SKILL.md. If it doesn't exist, read
[config.example.json](config.example.json) for the shape, ask the user for
real values, then write `config.json` (git-ignored):

- `repos` — absolute paths of repositories to scan.
- `outputDir` — where logs are saved (e.g. an Obsidian vault folder).
- `gitAuthor` — optional; a `git log --author` filter. When omitted, use each
  repo's `git config user.name`.

## 2. Determine the period

Default: today (`--since 00:00`). "Weekly" or an explicit range from the user
overrides it. State the resolved period in the log header.

## 3. Collect activity — from git, not memory

Per configured repo:

- `git log --all --author=<author> --since=<start> --until=<end> --pretty='%h %s (%D)'`
  for commits (all branches — feature-branch work counts).
- `git status --short` for uncommitted work in progress, noted as such.
- Skip repos with no activity; list them in one "no activity" line at the end.

Completion criterion: every configured repo was scanned; nothing in the log
is inferred without a commit or a dirty file behind it.

## 4. Compose the log

Group by repo, then by theme (feature/fix/docs — the Conventional Commit
prefixes make this mechanical). Write prose summaries in the user's
conversation language; keep commit subjects verbatim. Structure:

```markdown
# Work Log — <period>

## <repo name>
- <theme>: <1–2 line summary> (`abc1234`, `def5678`)
- In progress (uncommitted): <summary>

## Notes
<anything the user dictated to include — blockers, decisions, tomorrow's plan>
```

Before saving, ask the user one question: anything to add that git can't show
(meetings, reviews, blockers)? Fold the answer into **Notes** — or skip the
question when running unattended (e.g. from a scheduled routine) and note
"auto-generated" in the header instead.

## 5. Save and hand off

- Save as `<outputDir>/<yyyy-MM-dd>-work-log.md` (weekly:
  `<yyyy-MM-dd>-weekly.md`, dated on the period start). If the file already
  exists, show the diff and confirm before overwriting.
- Report the path and the activity summary. **This skill does not post to
  Slack** — if the user wants that, hand the composed Markdown to the
  `post-to-slack` skill as a separate step.

## Failure modes

- A configured repo path doesn't exist → skip it, name it in the report, and
  suggest updating `config.json`.
- No activity anywhere in the period → say so; don't fabricate a log.
