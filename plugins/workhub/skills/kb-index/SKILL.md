---
name: kb-index
description: Update the workhub vault knowledge base indexes (projects/knowledge/archive _index.md files). Smart mode detects changes and updates only what's needed. Full rebuild available with --full flag. Use after adding/moving documents or when indexes feel stale.
argument-hint: "[--full] [--zone <name>] [--dry-run]"
---

# KB Index — Smart Index Update

Update the vault's `_index.md` files efficiently. By default, detects what
changed and updates only affected entries. Full rebuild available when needed.

Indexed zones and their index files:

| Zone | Index |
|------|-------|
| `projects/` | `projects/_index.md` |
| `knowledge/` | `knowledge/_index.md` |
| `archive/` | `archive/_index.md` |
| `tasks/archive/` | `tasks/archive/_index.md` |

The board index `tasks/_index.md` and `_ai/index/tasks.json` are managed by the
workhub app — never rebuild them here. `tasks/archive/_index.md` is a different
file (a summary of *completed/inactive* tasks) and **is** managed by this
command. `inbox/` and `journal/` are intentionally unindexed.

## Usage

```
/kb-index                      # Smart update (diff-based, fast)
/kb-index --full               # Full rebuild (scan everything)
/kb-index --zone knowledge     # Update one zone only
/kb-index --dry-run            # Preview changes without writing
```

## 3-Tier Strategy

Choose the lightest approach that fits the situation:

### Tier 1: Per-File Update (via kb-ingest) — ~200 tokens
**When:** A single file was ingested or moved.
**How:** kb-ingest already handles this — adds one line to `_index.md`.
**No need to run kb-index separately.**

### Tier 2: Smart Diff Update (default kb-index) — ~500-1500 tokens
**When:** A few files changed, or "something feels off."
**How:** Compare existing `_index.md` entries against actual files on disk.
Only process differences. Do not re-render from
`templates/_index.md.template` in this mode.

### Tier 3: Full Rebuild (kb-index --full) — ~3-4K tokens
**When:** Major reorganization, initial setup, or indexes are badly corrupted.
**How:** Scan everything from scratch, regenerate all indexes from
`templates/_index.md.template`.

## Tier 2: Smart Diff — Execution Flow

This is the **default** behavior when you run `/kb-index`.

```
Step 1: READ existing indexes (cheap — ~200 tokens total)
  Read each zone _index.md (10-20 lines each)
  Extract: listed items, last updated date

Step 2: DETECT changes (cheap — tool calls only, no file reads)
  For each zone:
    Glob: list current subdirectories and .md files on disk
    Compare against items listed in _index.md
    Classify each item:
      MATCH    — in index AND on disk → skip (no action)
      ADDED    — on disk but NOT in index → needs adding
      REMOVED  — in index but NOT on disk → needs removing

  If zero differences found:
    Log "[date] index | no changes detected" → done

Step 3: PROCESS only differences
  For ADDED items only:
    Read the new file's overview/frontmatter (~50-100 tokens per file)
    Generate one-line index entry
  For REMOVED items:
    Delete the line from _index.md
  Skip MATCH items entirely — don't re-read, don't regenerate

Step 4: UPDATE indexes
  Edit (not rewrite) each affected _index.md:
    Insert new entries, remove deleted entries
    Update summary count line
    Update "updated: {today}" in frontmatter

Step 5: LOG
  Append to _ai/logs/kb-log.md:
  "[date] index-update | added N, removed M | touched K zones"
```

### Token Cost by Scenario

| Scenario | Tokens | Why |
|----------|--------|-----|
| Nothing changed | ~200 | Read 3 indexes + globs |
| 1 file added | ~350 | Above + read 1 overview |
| 3 files added, 1 removed | ~600 | Above + read 3 overviews |
| 10+ files changed | ~1500 | Consider --full instead |
| Major reorg (--full) | ~3-4K | Full vault scan |

## Tier 3: Full Rebuild — Execution Flow

Only runs with `--full` flag:

```
1. SCAN each zone
  projects/: list project folders, read overview files, extract status
  knowledge/: list topic folders, count files, extract topics
  archive/: count entries
  tasks/archive/: list .md files, read each frontmatter + Results/Description
    first sentence, emit one line per task (see tasks/archive/ entry format)

2. GENERATE _index.md per zone (from scratch)
  Read templates/_index.md.template
  Substitute:
    {{CATEGORY}} -> zone name
    {{DATE}} -> today
    {{SUMMARY_LINE}} -> counts / brief overview
    {{ENTRIES}} -> generated lines for that zone

  Rules:
  - 10-20 lines per index
  - Active/important first, then alphabetical
  - [[wikilinks]] for references

3. LOG
  "[date] index-rebuild | N zones | M total entries"
```

## Template Usage Contract

- `templates/_index.md.template` defines the canonical `_index.md` shape.
- Use the template only for `kb-index --full` rebuilds.
- For Tier 1/2 updates, edit the existing `_index.md` in place, preserving the
  generated structure: update date, summary line, and entries without
  inventing a new layout.

## Smart Detection Details

### What counts as an "item"
- projects/: subdirectories (each project is a folder)
- knowledge/: topic subdirectories
- archive/: subdirectories (archived containers)
- tasks/archive/: each `.md` file directly under it (one archived task = one item)
- Standalone .md files in a zone root are also tracked

### tasks/archive/ entry format

This index doubles as the **AI digest of archived tasks**: agents answer
"what did T-#### do / have we solved X before" from these one-liners instead
of opening the task files, so the per-entry format is fixed and each entry
stays on one line.

Entries are grouped under a `## <year>` heading (the task's `created` year,
falling back to `updated`), newest year first; within a year, by id
descending. An agent looking something up reads only the relevant year
section, so reads stay bounded as the archive grows:

```
## 2026
- [[T-#### title]] — one-sentence result summary (project: <project>) → [[deliverable]]
```

Derive the summary from the task file: prefer the first sentence of its
`## Results` section; fall back to the first sentence of `## Description` when
`## Results` is empty. Omit the `(project: …)` suffix when the task has no
`project`. Append `→ [[link]]` only when `## Results` links a polished
deliverable note (in `projects/` or `knowledge/`) — at most one link, the main
one. For a smart diff update, only read the newly-added task files — never
re-read tasks already listed in the index; add a new `## <year>` heading when
the first task of a year arrives (existing flat indexes are re-sectioned once,
on the next update that touches them).

### When to recommend --full
If diff detects >30% items changed, suggest: "Many changes detected. Rebuild with --full?"

## Obsidian CLI Enhancement

When `obsidian` is available:
```bash
obsidian search query="type: kb-index" limit=10   # find all index files
obsidian tags sort=count counts                    # tag inventory for enrichment
```

## Arguments

| Argument | Effect |
|----------|--------|
| (default) | Smart diff update — only process changes |
| `--full` | Full rebuild from scratch |
| `--zone <name>` | Limit to: projects, knowledge, archive, or tasks-archive |
| `--dry-run` | Show what would change without writing |

## Decision Guide

```
"added one file"              → /kb-ingest already handled it (Tier 1)
"a few things changed"        → /kb-index (Tier 2, default)
"major folder restructure"    → /kb-index --full (Tier 3)
"not sure if index is right"  → /kb-lint first, then /kb-lint --fix if needed
```
