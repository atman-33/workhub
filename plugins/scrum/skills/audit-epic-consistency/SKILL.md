---
name: audit-epic-consistency
description: Cross-check an Epic's user stories, PBIs, and acceptance criteria against the actual implementation in its repo, and propose fixes for mismatches, missing/unfinished descriptions, and unclear wording. Use when the user wants a consistency check between backlog and code, 整合性チェック, or asks whether the backlog still reflects what is really implemented.
---

# Audit Epic Consistency

`refine-backlog` audits board data against itself; this skill audits it
against the **code**. It reads the Epic's `.pm/` data plus the dedicated repo
clone, finds where stories/criteria and implementation have drifted apart,
and applies only the fixes the user approves.

## Steps

1. **Confirm the Epic** (monday group title in `mondayEpics`) and scope —
   default: all items in the Epic that are In Progress or Done; the user may
   widen to the whole group or narrow to specific items.

2. **Refresh data**, same as `load-epic-context` step 2: run `save-all.mjs`
   and `sync-repo.mjs` for the group if stale (>60 min) or missing. A
   configured repo is **required** here — without it there is no code to
   audit against; stop and offer `setup-scrum-context`.

3. **Locate the code.** Read `.pm/repo/repo-state.json` → `mirrorPath` is the
   dedicated local clone, already checked out at the epic branch. Treat it as
   read-only. `.pm/repo/branch-diff.json`'s changed-file list is the map of
   what this Epic actually touched — use it to scope the investigation
   instead of sweeping the whole repo. For a broad sweep across many files,
   delegate to a read-only exploration agent (`code-explore`) and fold back
   only `file:line` findings.

4. **Audit each in-scope item** against three checks:
   - **Drift** — the item/AC describes behavior the code contradicts (or the
     code implements more/differently than the item records). Evidence
     required: cite `file:line` from the mirror, never guess from the title.
   - **Gaps** — implemented items with no `acceptance.md` (check
     `pbi/<itemId>-*/acceptance.md`), empty criteria, or stories missing
     essential description for what was actually built.
   - **Clarity** — titles/stories a newcomer could not map to the behavior
     (vague verbs, internal jargon, stale names after a rename in code).
   Completion criterion: every in-scope item has a verdict on all three
   checks — consistent, or listed with specific evidence.

5. **Report and save.** A table in chat: item (id + title) → finding type →
   evidence (`file:line` or missing-file) → concrete proposed fix (rewritten
   AC in Given/When/Then, rewritten title, added description — drafted, not
   generic advice). Save the same content as
   `.pm/reports/audits/audit-<YYYY-MM-DD>.md`.

6. **Apply what's approved**, exactly like `refine-backlog` step 4: AC edits
   go to the item's `acceptance.md`; title/description edits on monday go
   through the `monday-api-mcp` server (confirm connected; list
   `mcp__monday-api-mcp__*` tools before assuming names), else hand back a
   paste-ready list. Never edit code from this skill — findings about code
   bugs are reported, not fixed here.

## Failure modes

- No `repo` configured for the Epic → stop at step 2 (this skill cannot run
  board-only; that is `refine-backlog`'s job).
- `MONDAY_TOKEN` missing → `save-all.mjs` exits 1; point to the plugin README.
- Legacy `.snapshots/` guard fires → run `migrate-epic-layout.mjs`, retry.
- Item has no `pbi/` folder scaffold → note "AC file missing (no scaffold)"
  and offer `init-task.mjs --item <id>` rather than writing files ad hoc.
