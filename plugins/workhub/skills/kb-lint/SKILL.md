---
name: kb-lint
description: Health check for the workhub vault knowledge base. Detects orphan documents, broken links, index drift, tag issues, and stale content across projects/knowledge/archive. Run periodically or as part of weekly review.
argument-hint: "[--fix] [--zone <name>]"
---

# KB Lint — Knowledge Base Health Check

Audit the workhub vault for structural issues, inconsistencies, and
maintenance opportunities. Covers the note zones (`inbox/`, `projects/`,
`knowledge/`, `archive/`) plus a size check on `profile/decision-policy.md` —
the task board (`tasks/`) is app-managed and only gets link checks.

## Usage

```
/kb-lint                       # Full report (read-only)
/kb-lint --fix                 # Auto-fix safe issues
/kb-lint --zone knowledge      # Lint only one zone
```

## Checks

### 1. Index Drift
Compare `_index.md` contents (`projects/_index.md`, `knowledge/_index.md`,
`archive/_index.md`) against actual files on disk.

| Issue | Meaning |
|-------|---------|
| MISSING | Listed in index but file/folder not found |
| UNLISTED | File/folder exists but not in index |
| STALE_INDEX | `updated` date > 7 days older than newest change in the zone |

**Auto-fix:** Add unlisted entries, remove missing entries, update dates.

### 2. Orphan Documents
Files in `projects/`, `knowledge/`, or `archive/` that have:
- No incoming `[[wikilinks]]` from other files
- No entry in any `_index.md`
- No tags

Exclude from check: `journal/**`, `inbox/**`, `tasks/**`, `templates/**`,
`_ai/**`, `_index.md`, `home.md`, `AGENTS.md`, `CLAUDE.md`.

**Report:** List orphans with suggested action (link, tag, or archive).

### 3. Tag Consistency

| Issue | Rule |
|-------|------|
| MISSING_PROJECT_TAG | File in `projects/x/` lacks `#proj/x` |
| BAD_TAG_FORMAT | Spaces or unexpected casing in tag |
| CROSS_REF_TAG | `#proj/x` tag on file outside `projects/` — note as intentional cross-reference |

**Auto-fix:** Add missing `#proj/` tags to frontmatter.

### 4. Broken Links
For each `[[wikilink]]` found in vault documents:
- Verify target file exists
- Report `BROKEN_LINK` if not found

With obsidian CLI: `obsidian links broken`
Without CLI: Grep for `\[\[.*?\]\]`, resolve each target.

### 5. Frontmatter Quality
Check documents in note zones for required fields:

| Field | Required? |
|-------|-----------|
| `title` | Yes |
| `created` | Yes |
| `tags` | Recommended |
| `type` | Recommended |

Task files (`tasks/`) follow the task schema instead — do not flag them here.

**Report:** Count of documents missing each field, list worst offenders.

### 6. Stale Content

| Issue | Condition |
|-------|-----------|
| POSSIBLY_STALE | Project note not modified >30 days while the project is active |
| SHOULD_ARCHIVE | `projects/<name>/` whose project is finished but still outside `archive/` |
| MISPLACED | Actively edited material found in `archive/` |
| INBOX_PILEUP | `inbox/` holds items older than 14 days → suggest `/kb-ingest` |

### 7. Decision policy size

`profile/decision-policy.md` is read in full every time an agent is about to
ask the owner something, and by the `secretary` subagent on every question it
gates. It holds the axes of a decision; the individual calls belong in
`profile/decision-log.md`, which is only ever grepped.

| Issue | Condition |
|-------|-----------|
| POLICY_RULES_OVER_LIMIT | `## Promoted rules` holds more than 12 entries, or one entry runs over 3 lines |
| POLICY_TOO_LONG | `profile/decision-policy.md` exceeds 120 lines |
| POLICY_LOG_ENTRIES | The policy carries entries that read as individual cases (a date + task id + `from:`) outside `## Promoted rules` |

**Report:** name the offending entries and suggest what to do — merge two
promoted rules into the axis they share, drop one that a later rule subsumes,
or move a case down to `profile/decision-log.md`. Never auto-fix: deciding
which rule survives is the owner's call.

`profile/decision-log.md` has no size limit and is not checked here.

## Output Format

```markdown
# KB Lint Report — {date}

## Summary
- Passed: N checks
- Warnings: N items
- Errors: N items

## Details
### Index Drift
...
### Orphan Documents
...
### Tag Issues
...
### Broken Links
...
### Frontmatter Quality
...
### Stale Content
...
### Decision Policy Size
...

## Recommended Actions
1. {highest priority}
2. ...
```

## Severity

| Level | Examples | Auto-fixable |
|-------|----------|-------------|
| Error | Broken links, missing files | Some |
| Warning | Missing tags, orphans, stale content, policy over limit | Most (never the policy) |
| Info | Optimization suggestions, inbox pileup | No |

## Log Entry

Append to `_ai/logs/kb-log.md`:
```
[date] lint | passed N | warnings N | errors N | fixed N
```

## Arguments

| Argument | Effect |
|----------|--------|
| `--fix` | Auto-fix safe issues (index drift, tag addition) |
| `--zone <name>` | Limit to one zone: projects, knowledge, or archive |
