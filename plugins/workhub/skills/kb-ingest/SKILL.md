---
name: kb-ingest
description: Ingest documents from the workhub vault inbox into the knowledge base. Classifies notes into projects/knowledge/archive, proposes tasks for actionable items, links, and indexes. Use when new notes land in inbox/ or a path needs filing.
argument-hint: "[file-or-folder-path]"
---

# KB Ingest — Inbox Intake + Classification + Linking

Process new documents into the workhub vault. Reads content, classifies into
the right zone, plans a folder-first destination and canonical filename,
generates metadata, creates wikilinks, updates related documents, maintains
indexes — and proposes tasks for actionable items.

## Vault zones (classification targets)

| Zone | Contents |
|------|----------|
| `inbox/` | raw input landing zone — the default ingest source |
| `projects/<name>/` | notes tied to an active project (deliverables, design notes) |
| `knowledge/<topic>/` | durable reference knowledge, organized by topic |
| `archive/` | completed, historical, or inactive material |
| `journal/` | daily/weekly notes — **never an ingest target or source** |
| `tasks/` | task board — actionable items become tasks (see TASK step) |

## Usage

```
/kb-ingest                      # Process all eligible files in inbox/
/kb-ingest path/to/file.md      # Process a specific file
/kb-ingest path/to/folder/      # Process all eligible .md files in a folder
```

## Structural README Exception

- Treat `inbox/**/README.md` as structural guidance notes, not ingest candidates.
- Exclude these README files from default inbox scans and folder-based batch ingest.
- If one is passed explicitly, stop and ask the user before any move, rename,
  frontmatter, summary, wikilink, backlink, or index action.

## Execution Flow

For each document to ingest:

### 1. READ
- Read full document content
- Extract existing frontmatter (preserve if present)
- Identify document type: note, reference, meeting, idea, log, paper, etc.
- Note content length (affects summarization decision)

### 2. ANALYZE
- Read relevant `_index.md` files for context (NOT full documents — token-efficient)
- Determine classification:

| Signal | Classification |
|--------|---------------|
| Belongs to a registered project (see `.claude/project-context.json`) or an existing `projects/<name>/` | `projects/<name>/` |
| Actionable: todo, request, bug report, concrete idea to implement | propose a **task** (see step 3-T) — the note itself still gets filed |
| Tutorial, how-to, reference, research result, collected info | `knowledge/<topic>/` |
| Ongoing life/work domain knowledge with no end date | `knowledge/<topic>/` |
| Completed, historical, inactive | `archive/` |
| Diary-like daily record | suggest `journal/` but ask user |
| Unclear | Ask user |

- Identify related existing documents by topic, tags, or content overlap
- Identify the best existing container folder inside the target zone
- Propose a canonical title and filename before moving the file

### 3. PLAN PLACEMENT
- Decide the full destination before writing anything:
  - target zone, target container subdirectory, canonical filename
- Default to **subdirectory-first** placement for `projects/`, `knowledge/`, and `archive/`
- Topic folders under `knowledge/` are lowercase kebab-case English (e.g.
  `knowledge/infra/`, `knowledge/counseling/`, `knowledge/cooking/`)
- Reuse an existing folder when there is a strong semantic match
- If no suitable folder exists, propose a new subdirectory and **ask the user before creating it**
- Do not place newly ingested files directly in a zone root unless the user
  explicitly prefers a standalone note, or no meaningful container exists yet
  and the user declines creating one
- If the plan includes a rename, show `old name -> new name` in the confirmation summary
- When confidence is low or multiple containers are plausible, ask user

### 3-T. TASK (actionable items)
When a note (or a section of it) is actionable:
- Offer to create a task on the board. If the user agrees:
  - Read `_ai/index/tasks.json` to find the next free `T-####` id
    (the workhub app is the id authority — if the index is missing or stale,
    ask the user to create the task in the app instead)
  - Create `tasks/T-#### <title>.md` from `templates/task.md` with
    `status: inbox`, `assignee: me`, today's `created`/`updated`
  - Put the actionable summary in `## Description` and wikilink the source note
- The source note is still filed normally; the task links to it, not replaces it.

### 4. MOVE
- Move file to the planned subdirectory (create the approved folder if needed)
- Rename during the move when the canonical filename is approved
- If already in the correct container with the correct filename, skip move/rename

### 5. FRONTMATTER
Add or update frontmatter fields:

```yaml
---
title: Document Title
created: 2026-04-05          # preserve original if exists
type: note                    # note|reference|meeting|idea|log|paper
tags:
  - "#proj/project-name"      # if project-related
  - "#type/reference"         # document type
  - "#topic/kubernetes"       # subject matter
related:
  - "[[Related Document]]"    # discovered relationships
source: https://...           # URL or citation (if applicable)
---
```

- `title` should normally match the canonical filename without the `.md` extension
- Never touch the frontmatter of files under `tasks/` beyond the TASK step above

### 6. SUMMARIZE (long documents only)
For documents over 500 words:
- Generate a concise summary after frontmatter (under 200 words)
- Format: `> **Summary:** ...` callout block

### 7. WIKILINK — Create Forward Links
Scan document content for existing vault entities:
- Document titles → `[[Document Title]]`
- Project names → `[[project-name]]`
- Technical terms matching existing docs → `[[term]]`

Rules: link first occurrence only per term; skip code blocks, URLs, and
frontmatter; maximum ~10 auto-links per document; don't link common words.

### 8. BACKLINK — Update Related Documents
For each strongly related document (max 3):
- Check if it already references the new doc
- If not, append to its `## Related Documents` section (create if missing):
  `- [[New Document]] — brief context`
- Never add backlinks into `tasks/` bodies outside the `## Results` section

### 9. INDEX — Update Indexes
- Add or refresh the entry in the target zone's `_index.md`
  (`projects/_index.md`, `knowledge/_index.md`, or `archive/_index.md`);
  entries point at container folders, or at standalone notes the user kept in the root
- Maintain sort order within the index

### 10. LOG
Append to `_ai/logs/kb-log.md`:
```
[2026-04-05] ingest | Document Title | → knowledge/infra/ | updated 2 docs | task T-0043 created
```

## Placement and Naming Rules

### Container Selection Rules
- `projects/`: always place documents inside a project folder named after the project
- `knowledge/`: place documents inside a topic folder; topic names describe a
  durable theme, not a one-off document title
- `archive/`: preserve the source container name when practical; otherwise
  propose an archive container first
- Existing loose notes may remain as-is; **folder-first applies to new ingest by default**

### Filename Canonicalization Rules
- Determine the canonical title in this priority order:
  1. Existing frontmatter `title`  2. H1 heading  3. First meaningful section heading  4. Current filename
- Keep an already clear filename when it matches the canonical title closely
- Rename low-information or temporary filenames such as `Untitled`, `IMG_1234`,
  `meeting notes`, `copy`, `final`, `draft`, or date-only names missing the subject
- Filename patterns when renaming:
  - `YYYY-MM-DD｜Title` for date-centric records (sessions, meetings, logs, events)
  - `Title` for evergreen concept or reflection notes
  - `Domain｜Artifact` for reusable prompts, procedures, templates, reference material
- Keep the note language; do not translate titles just to normalize filenames
- Remove Windows-invalid characters and collapse redundant whitespace/punctuation
- Ask the user before renaming when the current filename is still meaningful,
  or when the note may already be referenced from elsewhere in the vault

### Confirmation Summary Format
Before executing any move that creates a new folder or renames a file, present a short plan:

```text
Proposed ingest plan
- source: inbox/...
- target: knowledge/<topic>/
- folder action: reuse existing | create new folder
- filename: old-name.md -> new-name.md
- task: none | create T-#### "title" (status: inbox)
- confidence: high|medium|low
- rationale: why this folder and filename fit
Proceed?
```

## Batch Mode

When processing multiple files (inbox/ or a folder):
1. Collect all eligible files first, excluding `inbox/**/README.md`
2. Classify all at once (cross-document decisions are better)
3. Build one combined placement plan covering new folders, renames, and proposed tasks
4. Ask once for approval if any new subdirectories, renames, or tasks are proposed
5. Process moves, links, and backlinks after approval
6. Update indexes once at end (not per-file)
7. Single batch log entry

## Obsidian CLI Integration

When available:
```bash
obsidian search query="related term"     # find related docs
obsidian backlinks file="Document"       # check existing backlinks
obsidian tags                            # verify tag consistency
```
Fallback (no CLI): Grep for related terms, Glob for file discovery, Read
frontmatter for existing tags/links.

## Safety Rules

- **Never delete** the original file — move only
- **Never ingest from or into** `journal/`, `tasks/`, `templates/`, `_ai/`, or `attachments/`
- **Folder-first is the default** for new ingest in projects, knowledge, and archive
- **Never ingest** `inbox/**/README.md` during default scans or batch processing
- **Never create** a new subdirectory or task without explicit user approval
- **Ask user** before renaming files, unless the filename is clearly temporary or low-information
- **Ask user** when classification confidence is low or multiple containers are plausible
- **Do not reorganize** existing notes into folders unless the user asks for cleanup
- **Never modify** source document content beyond frontmatter and summary
- **Preserve** all existing wikilinks and formatting
- Perform rename/move decisions **before** generating new links, backlinks, or index entries
