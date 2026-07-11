---
name: kb-ingest
description: Ingest documents into the PARA Knowledge Base. Classifies, moves, links, and indexes new documents from Inbox or a specified path. Use when new documents need processing into the vault.
argument-hint: "[file-or-folder-path]"
---

# KB Ingest — Document Intake + Classification + Linking

Process new documents into the Knowledge Base. Reads content, classifies into the right PARA location, plans a folder-first destination and canonical filename, generates metadata, creates wikilinks, updates related documents, and maintains indexes.

## Usage

```
/kb-ingest                      # Process all eligible files in Inbox/
/kb-ingest path/to/file.md      # Process a specific file
/kb-ingest path/to/folder/      # Process all eligible .md files in a folder
```

## Structural README Exception

- Treat `Inbox/**/README.md` as structural guidance notes, not normal ingest candidates.
- Exclude these README files from default Inbox scans and folder-based batch ingest.
- If one of these README files is passed explicitly, stop and ask the user before any move, rename, frontmatter, summary, wikilink, backlink, or index action.

## Execution Flow

For each document to ingest:

### 1. READ
- Read full document content
- Extract existing frontmatter (preserve if present)
- Identify document type: paper, note, reference, meeting, idea, log, etc.
- Note content length (affects summarization decision)

### 2. ANALYZE
- Read relevant `_index.md` files for context (NOT full documents — token-efficient)
- Determine PARA classification:

| Signal | Classification |
|--------|---------------|
| Has deadline, phases, deliverables | `1. Projects/` → which project? |
| Paper/논문, research, study | `2. Areas/Paper/` |
| Career, Interview/면접, resume | `2. Areas/Career/` |
| Ongoing responsibility, no end date | `2. Areas/` → which area? |
| Tutorial, how-to, reference guide | `3. Resources/` → which category? |
| Completed, historical, inactive | `4. Archive/` |
| Unclear | Ask user |

- Identify related existing documents by topic, tags, or content overlap
- Identify the best existing container folder inside the target category
- Propose a canonical title and filename before moving the file

### 3. PLAN PLACEMENT
- Decide the full destination before writing anything:
  - target PARA category
  - target container subdirectory
  - canonical filename
- Default to **subdirectory-first** placement for `1. Projects/`, `2. Areas/`, `3. Resources/`, and `4. Archive/`
- Reuse an existing folder when there is a strong semantic match
- If no suitable folder exists, propose a new subdirectory and **ask the user before creating it**
- Do not place newly ingested files directly in a category root unless:
  - the user explicitly prefers a standalone note, or
  - no meaningful container exists yet and the user declines creating one
- If the plan includes a rename, show `old name -> new name` in the confirmation summary
- When confidence is low or multiple containers are plausible, ask user

### 4. MOVE
- Move file to the planned subdirectory
- Create the approved subdirectory if needed
- Rename the file during the move when the canonical filename is approved
- If already in the correct container with the correct filename, skip move/rename

### 5. FRONTMATTER
Add or update frontmatter fields:

```yaml
---
title: Document Title
created: 2026-04-05          # preserve original if exists
type: paper                   # paper|note|reference|meeting|idea|log
tags:
  - "#proj/project-name"      # if project-related
  - "#type/paper"             # document type
  - "#topic/kubernetes"       # subject matter
related:
  - "[[Related Document]]"    # discovered relationships
source: https://...           # URL or citation (if applicable)
---
```

Additional rule:
- `title` should normally match the canonical filename without the `.md` extension

### 6. SUMMARIZE (long documents only)
For documents over 500 words:
- Generate a concise summary after frontmatter (under 200 words)
- For papers: title, authors, key contribution, method, results
- Format: `> **Summary:** ...` callout block

### 7. WIKILINK — Create Forward Links
Scan document content for existing vault entities:
- Document titles → `[[Document Title]]`
- Project names → `[[project-name]]`
- Technical terms matching existing docs → `[[term]]`

Rules:
- Link first occurrence only per term
- Skip code blocks, URLs, and frontmatter
- Maximum ~10 auto-links per document
- Don't link common words even if a doc exists with that name

### 8. BACKLINK — Update Related Documents
For each strongly related document (max 3):
- Check if it already references the new doc
- If not, add to its `## Related Documents` section (create section if missing; use `## 관련 문서` for Korean vaults)
- Append: `- [[New Document]] — brief context`

### 9. INDEX — Update Indexes
- If the note lives inside a subdirectory, add or refresh the category index entry for that container folder
- If the user explicitly keeps the note as a standalone root note, add or refresh the note entry directly
- Update counts in top-level `0. Common/index.md`
- Maintain sort order within index

### 10. LOG
Append to `0. Common/log.md`:
```
[2026-04-05] ingest | Document Title | → 2. Areas/Paper/ | updated 2 docs
```

## Placement and Naming Rules

### Container Selection Rules
- `1. Projects/`: always place documents inside a project folder
- `2. Areas/`: place documents inside an area folder named for an ongoing responsibility or durable life domain
- `3. Resources/`: place documents inside a topic or reference-material folder
- `4. Archive/`: preserve the source container when practical; otherwise propose an archive container first
- New container names should describe a durable theme, not a one-off document title
- Existing loose notes may remain as-is; **folder-first applies to new ingest by default**

### Filename Canonicalization Rules
- Determine the canonical title in this priority order:
  1. Existing frontmatter `title`
  2. H1 heading
  3. First meaningful section heading
  4. Current filename
- Keep an already clear filename when it already matches the canonical title closely
- Rename low-information or temporary filenames such as `Untitled`, `IMG_1234`, `meeting notes`, `copy`, `final`, `draft`, or date-only names that are missing the actual subject
- Use one of these filename patterns when renaming:
  - `YYYY-MM-DD｜Title` for date-centric records such as sessions, meetings, letters, logs, and event notes
  - `Title` for evergreen concept or reflection notes
  - `Domain｜Artifact` for reusable prompts, procedures, templates, and reference material
- Keep the note language; do not translate titles just to normalize filenames
- Remove Windows-invalid characters and collapse redundant whitespace or punctuation
- Keep version suffixes only when multiple live variants are intentionally retained
- Ask the user before renaming when the current filename is still meaningful, or when the note may already be referenced from elsewhere in the vault

### Confirmation Summary Format
Before executing any move that creates a new folder or renames a file, present a short plan:

```text
Proposed ingest plan
- source: Inbox/...
- target: 2. Areas/<folder>/
- folder action: reuse existing | create new folder
- filename: old-name.md -> new-name.md
- confidence: high|medium|low
- rationale: why this folder and filename fit
Proceed?
```

## Batch Mode

When processing multiple files (Inbox/ or folder):
1. Collect all eligible files first for batch classification, excluding `Inbox/**/README.md`
2. Classify all at once (cross-document decisions are better)
3. Build one combined placement plan covering new folders and renames
4. Ask once for approval if any new subdirectories or renames are proposed
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

Fallback (no CLI):
```
Grep for related terms, Glob for file discovery,
Read frontmatter for existing tags/links
```

## Safety Rules

- **Never delete** the original file — move only
- **Folder-first is the default** for new ingest in Projects, Areas, Resources, and Archive
- **Never ingest** `Inbox/**/README.md` during default Inbox scans or folder-based batch processing
- **Do not add** frontmatter, summaries, backlinks, renames, or moves to `Inbox/**/README.md` unless the user explicitly requests that action
- **Never create** a new subdirectory without explicit user approval
- **Ask user** before renaming files, unless the filename is clearly temporary or low-information
- **Ask user** when classification confidence is low or multiple containers are plausible
- **Do not reorganize** existing PARA notes into folders unless the user asks for cleanup
- **Never modify** source document content beyond frontmatter and summary
- **Preserve** all existing wikilinks and formatting
- Perform rename/move decisions **before** generating new links, backlinks, or index entries
