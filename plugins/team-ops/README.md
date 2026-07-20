# team-ops

Team operations on a **shared folder as the single source of truth**: a team
knowledge base, a file-based product backlog with sprint ceremonies,
multi-repo development tracking against per-project dev-main branches, and a
daily burndown/spec reporting cycle.

Built zero-base as the team-oriented successor concept to the `scrum` plugin
(which stays available for the monday.com + Drive snapshot workflow). The
full design — folder layout, information-flow diagrams, and the operations
cycle — lives in **[docs/design.html](docs/design.html)**; keep that document
in sync with any change to this plugin (see the workhub repo rule
`.claude/rules/team-ops-design-doc.md`).

## How it works

- One locally synced shared folder (Google Drive / OneDrive / file server)
  holds `<teamRoot>/ai/` with two zones:
  - `knowledge/` — the team KB (rules, onboarding, topic folders, all
    indexed via `_index.md`) that newcomers can self-serve from;
  - `projects/<p>/` — per-project operations: `prd/`, `backlog/` (one PBI =
    one file), `sprints/`, `docs/spec/spec.md` (living spec),
    `reports/daily/`, and `repos/<repo>/` (machine-generated dev tracking).
- Shared settings live in the shared folder (`_meta/team.json` — including
  the team **content language** for KB/backlog/spec documents — and
  `projects/<p>/config/project.json` — repositories and sprint settings);
  only machine-local paths live in `.claude/team-context.json`.
- PBI ↔ code linkage is convention-based: work branches `pbi/<id>-<slug>`
  (issued by `start-pbi`), PBI ids in merge subjects, aggregated by the sync
  script into per-PBI activity.

## Components

### SessionStart hook

Injects a `<team-context>` block (team root, content language, active
projects, KB location) plus the knowledge-capture norm — "propose
`team-kb-save` when reusable team knowledge surfaces". No config file → no
injection, no nagging.

### CLI scripts (dependency-free, token-free)

| Script | Args | Purpose |
|---|---|---|
| `scripts/setup/init-team-context.mjs` | `--team-root <path> [--me <name>] [--project <name>] [--workspaces-root <path>] [--language <tag>]` | Write/merge the local config, scaffold the shared `ai/` skeleton and optional project skeleton (create-if-missing only). |
| `scripts/sync/sync-project-repos.mjs` | `<project>` | For every configured repo: maintain a script-owned bare mirror under `repoWorkspacesRoot`, append new dev-main commits to `repos/<repo>/commits.jsonl`, refresh `diff-vs-default.json`, aggregate `pbi-activity.json`, update `repo-state.json`. |
| `scripts/snapshot/progress-snapshot.mjs` | `<project>` | Append today's line to `backlog/progress-history.jsonl` (status counts, points, sprint remaining points vs `scope.json`). Same-day reruns replace the line. |

Requirements: Node.js 18+ and `git` on `PATH`. Repo mirrors are read-only
and live locally (default `~/.team-ops-repos/`) — never inside the shared
folder, never your own checkout.

### Skills

| Group | Skill | Role |
|---|---|---|
| Setup | `setup-team-context` | Configure a machine/project, scaffold the shared skeleton |
| Knowledge | `team-kb-save` / `team-kb-query` / `team-kb-index` | Save, answer from, and index the team KB |
| Knowledge | `team-onboard` | Newcomer briefing from KB + spec + latest report |
| Backlog | `manage-backlog` | Add/refine/split/reorder PBIs (file-based backlog) |
| Backlog | `start-pbi` | Set a PBI to doing, issue the `pbi/<id>-<slug>` branch name |
| Sprint | `plan-sprint` / `review-sprint` / `write-retro` | Ceremonies; `plan-sprint` writes the burndown baseline `scope.json` |
| Session | `load-project-context` | Prime a session from aggregates; maintain the project `_index.md` |
| Daily | `report-daily-progress` | `reports/daily/<date>.html` — status board + burndown + merges of the day |
| Daily | `update-spec` | Fold newly merged diffs + PBI acceptance criteria into `docs/spec/spec.md` |

### Daily routine (template)

Steps 1–2 are token-free scripts; 3–4 are the only AI work (4 is
conditional), so a daily cadence stays cheap. Create a scheduled routine
with a prompt like:

```
For the team-ops project "<project>" (resolve the team-ops plugin root from
installed_plugins.json; call it $TO):
1. node "$TO/scripts/sync/sync-project-repos.mjs" "<project>"
2. node "$TO/scripts/snapshot/progress-snapshot.mjs" "<project>"
3. Follow $TO/skills/report-daily-progress/SKILL.md to generate today's
   report (skip step 1 of the skill — data is already fresh).
4. Follow $TO/skills/update-spec/SKILL.md; it exits early when nothing new
   was merged.
Report: repos synced / new commits / report path / spec updated or not.
```

## Setup

1. Run the `setup-team-context` skill (or the init script directly) with
   the shared folder path; add `--project <name>` for your first project.
2. Edit `projects/<name>/config/project.json` — real repo URLs and each
   repo's `devMainBranch` (the project development main branch).
3. Optionally set the team content language in `_meta/team.json`
   (`"language": "ja"` etc.) — it governs KB/backlog/spec content; plugin
   docs and skills stay English.

## Status

v0.1.0 — initial walking skeleton of the full design. External tool mirrors
(monday.com etc.) are deliberately out of scope for the core; the shared
folder is the master.
