---
name: vault-migrate
description: Migrate another Obsidian vault into the workhub vault (copy-only, verified).
disable-model-invocation: true
argument-hint: "<source-vault-path>"
---

# Vault Migrate — copy another Obsidian vault into the workhub vault

Migrate the contents of a source Obsidian vault into the workhub vault's
zones. The single invariant is **copy-only**: the source vault is never
modified, moved, or deleted — every operation is a copy, and the source
survives intact as an archive (the only file ever written there is the final
`MIGRATED.md` marker).

Zone definitions and note conventions are owned by the vault's `CLAUDE.md`
and `.claude/rules/notes.md` — read them first; do not restate or override
them here.

## Steps

### 1. SURVEY the source vault

- Inventory top-level folders with file counts
  (`find <src> -type f | sed 's/\/[^/]*$//' | sort | uniq -c`), excluding `.obsidian/`.
- Detect the organizing scheme (PARA numbered folders, flat, topic folders,
  date folders) — it drives the mapping defaults below.
- Locate: daily-notes folder, attachments/canvas/excalidraw folders,
  `Templates/`, `.claude/` rules, `.obsidian/` config
  (`app.json`, `daily-notes.json`, `community-plugins.json`).
- Flag **sensitive files**: anything that looks like accounts, credentials,
  tokens, or encrypted notes. Never read their contents beyond the first
  line needed to classify them.

**Done when:** every top-level folder is classified and the sensitive-file
list is drawn up.

### 2. MAP source → zones and get approval

Build a mapping table. Defaults by scheme:

| Source pattern | Destination |
|---|---|
| Active project folders (incl. per-project inbox subtrees) | `projects/<kebab-name>/` |
| Ongoing-domain / reference folders (PARA Areas + Resources) | `knowledge/<kebab-topic>/` (translate topic names to English kebab-case) |
| Archive folders | `archive/<kebab-name>/` |
| Unclassified capture folders | `inbox/` (keep subfolders; `/kb-ingest` classifies later) |
| Daily/weekly notes | `journal/` |
| Attachments, Excalidraw, canvases | `attachments/` (excalidraw in a subfolder) |
| KB activity log | append to `_ai/logs/kb-log.md` |
| Reusable note templates | `templates/` (skip ones the vault already has) |

Always **skip**: the source's `CLAUDE.md`/`AGENTS.md`/READMEs, `Home.md`,
`.obsidian/`, `.claude/`, `*.code-workspace`, machine backups, and generated
indexes (`_index.md`, top-level index/dashboard — regenerated later).

Sensitive files map to `inbox/` at most, marked 要判断 for the user.

Present the table with one row per top-level item — destination, **skip**, or
**要判断** — plus the merge policy for name collisions (`cp -n`, source file
skipped and reported).

**Done when:** every top-level item has a row and the user has approved the
table. Do not copy anything before approval.

### 3. COPY

- Execute the approved mapping with `cp -rn` (no-clobber; never overwrite
  existing vault files).
- Create destination topic/project folders as mapped.

**Done when:** every approved mapping row has been executed.

### 4. VERIFY — delta-zero

Run the bundled checker:

```bash
python "${CLAUDE_PLUGIN_ROOT}/skills/vault-migrate/scripts/verify.py" \
  --mapping mapping.json <source-vault> <dest-vault>
```

(`mapping.json`: `[{"src": "2. Areas/仕事", "dst": "knowledge/work"}, ...]` —
write it to the scratchpad from the approved table.)

It checks three counters, all of which must be zero:

1. **missing** — a mapped source file with no file at its destination
2. **mismatch** — destination exists but differs in size (collision skipped by `cp -n`)
3. **link delta** — wikilink targets broken in the destination that were NOT
   already broken in the source (pre-existing broken links are reported
   separately and are not a migration failure)

**Done when:** all three counters are zero. If not, fix the copy (or amend
the mapping with user approval) and re-run — never hand-wave a nonzero count.

### 5. FINALIZE

- Update `projects/_index.md`, `knowledge/_index.md`, `archive/_index.md`
  with one line per migrated container (plain `folder/` code spans — wikilinks
  cannot target folders).
- Append a `migrate` entry to `_ai/logs/kb-log.md` summarizing the mapping.
- Adjust `.obsidian/` in the destination if unset: `daily-notes.json` folder →
  `journal/`, `app.json` `attachmentFolderPath` → `attachments/`,
  `newFileFolderPath` → `inbox/`. Never copy the source's community plugins or
  their settings (they may carry tokens) — list them for manual install instead.
- Write `MIGRATED.md` at the source root: migration date, the mapping table,
  and "new notes go to the workhub vault".
- Report the user's remaining actions: sensitive-file decisions, community
  plugins to install by hand, and `/kb-ingest` for whatever landed in `inbox/`.

**Done when:** the report ends with the remaining-actions list.
