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
/kb-ingest --unattended [--stale-days N] [--exclude <dir>,...]
                                # Headless mode for scheduled/automated runs:
                                # only stale files, auto-file the unambiguous,
                                # log the rest as pending-review (see below)
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

## Unattended Mode

`--unattended` runs the ingest headless for scheduled/automated maintenance
(the workhub app's vault-tidy routine launches it this way). There is no human
in the loop, so the interactive confirmation steps cannot be used: instead of
asking, this mode **auto-processes only what is unambiguous and safe, and
defers everything else to a review task** on the board (plus a machine-readable
pending list), so deferred items are visible and instructable instead of
sitting silently in the log.

Arguments:

| Argument | Effect |
|----------|--------|
| `--unattended` | Enable headless mode (no prompts; defer instead of asking) |
| `--stale-days N` | Only consider inbox files whose mtime is ≥ N days old (default 7) |
| `--exclude <dir>,...` | Skip these inbox subfolders entirely (default `_wip`) |

### Selection

1. Scan `inbox/` for `.md` files, then drop:
   - `inbox/**/README.md` (structural notes — always excluded)
   - anything under an excluded subfolder (`inbox/<dir>/**` for each `--exclude`
     entry; default `inbox/_wip/`) — this is the user's "not ready to file yet"
     holding area
   - files whose mtime is newer than `--stale-days` days ago (still being edited)
   - files already listed in `_ai/memory/tidy-pending.json` whose mtime is older
     than that JSON file's own mtime — they were deferred on a previous run and
     nothing changed since, so re-classifying them would only burn tokens. A
     pending file the user has edited *after* the last deferral is a candidate
     again (it may now be classifiable).
2. The remaining files are the unattended candidates.

### Auto-file vs. defer

For each candidate, run the normal READ → ANALYZE → PLAN classification, then:

- **Auto-file** only when ALL of these hold: classification confidence is high,
  a single existing target container clearly fits, no new subdirectory is
  needed, and no rename is needed (or the filename is clearly temporary/
  low-information per the canonicalization rules). Perform the MOVE →
  FRONTMATTER → WIKILINK → BACKLINK → INDEX steps as usual.
- **Defer (do not move)** and record a `pending-review` entry in the log when
  any of these is true: confidence is low, multiple containers are plausible, a
  new subdirectory would be required, or a rename needs human judgement. Never
  create folders and never rename ambiguous files unattended — these need a
  human. Leave the file in place and route it through the review task below.
  (The **review task is the one exception** to the no-tasks-unattended rule;
  never create any other task unattended.)

### Deferred items → pending list + review task

When this run ends with one or more deferred items (and also to clean up after
previous runs), do both of the following:

**1. Maintain `_ai/memory/tidy-pending.json`** — the machine-readable pending
list the workhub app's pre-check reads to avoid re-launching the agent for
files a human still has to look at. Rewrite the whole file each run:

```json
{
  "task": "T-0061",
  "updated": "2026-07-19T21:00:00+09:00",
  "files": [
    {
      "path": "inbox/random idea.md",
      "reason": "low confidence (2 plausible containers)",
      "proposal": "knowledge/product-ideas/ (new folder) or projects/workhub/"
    }
  ]
}
```

- `path` is vault-relative with forward slashes.
- Carry over still-unresolved entries from the previous file, **dropping any
  whose file no longer exists at that path** (the human resolved it).
- If nothing is pending anymore, write `"files": []` (keep the file).

**2. Create or update the single review task.** Deferred items must surface on
the task board where the human can see them, edit the proposals, and hand the
task to an agent — not only in a log nobody reads.

- Look in `_ai/index/tasks.json` for an existing open review task: tag
  `#tidy-review` with status `inbox`, `todo`, or `doing`. If the index is
  missing or stale, fall back to scanning `tasks/*.md` frontmatter.
- **If one exists**, update it: refresh the checklist in `## Description` to
  match the current pending list (add new items, drop resolved ones) and bump
  `updated`. Do not touch other frontmatter or the `## Results` section.
- **If none exists**, create `tasks/T-#### Vault tidy - review deferred inbox items.md`
  from `templates/task.md`, taking the next free `T-####` id from
  `_ai/index/tasks.json` (the app is the id authority — if the index is
  missing, skip task creation, log the fact, and leave the pending list as the
  only record). Frontmatter: `status: inbox`, `assignee: me`,
  `priority: low`, `tags: [tidy-review]`, today's `created`/`updated`.
- `## Description` format — one block per deferred file so the human can edit
  the plan in place, then assign the task to an agent to execute it:

  ```markdown
  Unattended vault tidy deferred these inbox files. For each item, edit the
  plan as needed, delete items to leave alone, then assign this task to an
  agent — it will execute the remaining plans (creating approved folders /
  renames), update the indexes, and clear `_ai/memory/tidy-pending.json`.

  ### inbox/random idea.md
  - reason deferred: low confidence (2 plausible containers)
  - proposed target: knowledge/product-ideas/ (new folder)
  - alternative: projects/workhub/
  - rename: none
  ```

- An agent later executing this task treats each surviving block as an
  **approved** plan: perform MOVE → FRONTMATTER → WIKILINK → BACKLINK → INDEX
  for it (folder creation and renames listed in the block are pre-approved by
  the human's edit), remove its entry from `tidy-pending.json`, and log
  normally.

### Log rotation

Before appending, check `_ai/logs/kb-log.md`: if its existing entries are from
a previous year, rename it to `_ai/logs/kb-log-<that-year>.md` (append to that
file if it already exists) and start a fresh `kb-log.md`. This keeps the live
log — which agents read and append to constantly — bounded to one year.

### Logging

Append per-file lines to `_ai/logs/kb-log.md` as usual for auto-filed items,
and a `pending-review` line for each deferred item with the reason, e.g.:

```
[2026-07-19] ingest (unattended) | Deploy notes | → knowledge/infra/ | auto-filed
[2026-07-19] ingest (unattended) | random idea | pending-review: low confidence (2 plausible containers)
```

Finish with one summary line so the caller can report counts without re-reading
the log:

```
[2026-07-19] ingest (unattended) | summary | auto-filed N, pending-review M, skipped-fresh K | review task T-####
```

(Omit the `review task` segment when nothing is pending and no open review
task exists.)

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
- **Respect the hold folder**: `inbox/_wip/` (and any other configured exclude
  folder) is a "not ready to file yet" area — never ingest its contents during
  default scans, batch processing, or unattended runs
- **Never create** a new subdirectory or task without explicit user approval
  (sole exception: the single unattended review task described above)
- **Ask user** before renaming files, unless the filename is clearly temporary or low-information
- **Ask user** when classification confidence is low or multiple containers are plausible
- **Do not reorganize** existing notes into folders unless the user asks for cleanup
- **Never modify** source document content beyond frontmatter and summary
- **Preserve** all existing wikilinks and formatting
- Perform rename/move decisions **before** generating new links, backlinks, or index entries
