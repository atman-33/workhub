---
name: kb-lint
description: Health check for the workhub vault knowledge base. Detects orphan documents, broken links, index drift, garbled (mojibake) text, tag issues, and stale content across projects/knowledge/archive. Run periodically or as part of weekly review.
argument-hint: "[--fix] [--zone <name>]"
---

# KB Lint — Knowledge Base Health Check

Audit the workhub vault for structural issues, inconsistencies, and
maintenance opportunities. Covers the note zones (`inbox/`, `projects/`,
`knowledge/`, `archive/`), the memory note types under `memory/notes/`, plus a
size check on `memory/identity/decision-policy.md` —
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
| SHOULD_ARCHIVE | `projects/NNNN-<name>/` whose project is finished but still outside `archive/` |
| MISPLACED | Actively edited material found in `archive/` |
| INBOX_PILEUP | `inbox/` holds items older than 14 days → suggest `/kb-ingest` |

### 7. Decision policy size

`memory/identity/decision-policy.md` is read in full every time an agent is about to
ask the owner something, and by the `secretary` subagent on every question it
gates. It holds the axes of a decision; the individual calls belong in
`memory/notes/`, which is reached by search (`cli.mjs notes`), never read whole.

The limits are measured by the `memory` plugin, not here, so the two cannot
drift apart:

```bash
node "<memory plugin>/engine/cli.mjs" doctor
```

Report its `cap:` lines — `policy entries` (more than 50 across every
section), `policy entry P-NN` (an entry over 3 lines), `policy ids` (an entry
with no `P-NN`, or one used twice) and `policy cases` (individual cases written
into the policy). The policy is not held to the 120-line limit of the other
`identity/` notes. Where that plugin is not installed, skip this section and say
so — do not re-implement the limits here.

**Report:** name the offending entries and suggest what to do — merge two
entries into the axis they share, drop one that a later entry subsumes, or move
a case down to `memory/notes/`. Never auto-fix: deciding
which rule survives is the owner's call.

`memory/notes/` has no size limit and is not checked here.

### 8. Memory note types

Only when the vault has a `memory/` folder. Notes there declare a `type:` and
are read back structurally — a session briefing asks for open decisions, not
for notes that look relevant — so a note with no type, or one missing the
fields its type is read by, is invisible rather than merely untidy.

The check is the `memory` plugin's own validator, so the two cannot disagree:

```bash
node "<memory plugin>/engine/cli.mjs" validate memory/notes/*.md
```

Where that plugin is not installed, skip this section and say so — do not
re-implement the rules here.

| Issue | Condition |
|-------|-----------|
| MEMORY_UNTYPED | A note under `memory/` with no `type:` |
| MEMORY_FIELDS | A typed note missing a field its type is required to carry |

**Report:** list the findings verbatim; the validator already explains each one
and why it matters. **Never auto-fix, and never treat this as a failure** —
validation warns by design. A memory whose writes can be rejected stops being
written to, and an empty memory is worse than an untidy one.

`memory/identity/` is exempt: those notes are read in full, never searched.

### 9. Garbled text (mojibake)

A note rewritten through the wrong encoding (typically PowerShell 5.1
`Get-Content` / `Set-Content`, whose default is ANSI/CP932) turns unreadable,
and a backup commit then records it as an ordinary change, so nothing flags it.
The check is a bundled read-only script over the git-tracked
`.md .json .yml .yaml .txt .canvas .base` files:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-mojibake.mjs" --vault <vault>   # exit 1 when something is suspect
```

| Issue | Condition |
|-------|-----------|
| INVALID_UTF8 | The bytes are not valid UTF-8 (a CP932 file written back) |
| REPLACEMENT | The text contains U+FFFD |
| MOJIBAKE | 20+ halfwidth katakana, or CP932-misread kanji (繧 繝 縺 ...), making up more than 5% of the characters |

`.playwright-mcp/`, `node_modules/` and `.git/` are skipped: snapshots and tool
output there garble on their own and are not notes. The 5% / 20-hit gate keeps
Japanese notes that legitimately mention halfwidth katakana (font names, quoted
UI text; a handful per file) out of the report. If a file you know is fine is
flagged, report it as is and say so; do not loosen the gate silently.

**Report:** one line per file with the issue and detail. Add a restore hint to
each: find the last good commit with
`git log --oneline -- <file>`, check it with
`git show <commit>:<file> | iconv -f UTF-8 -t UTF-8 >/dev/null`, and compare
`git diff <commit> HEAD -- <file>` to carry over later edits. **Never
auto-fix, not even with `--fix`:** the file may hold edits made after the
damage, so the owner decides which version survives.

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
| Error | Broken links, missing files, garbled text (never auto-fixed) | Some |
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
