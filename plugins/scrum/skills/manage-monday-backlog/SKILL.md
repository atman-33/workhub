---
name: manage-monday-backlog
description: Read or update the product backlog on monday.com. Use when the user asks about backlog items, monday.com boards, tickets, or tasks tracked in monday.com.
---

# monday.com backlog

Walking-skeleton workflow for talking to the product backlog on monday.com.

The **primary path is dependency-free CLI scripts** in
`${CLAUDE_PLUGIN_ROOT}/scripts/monday/` — they only need `MONDAY_TOKEN` (and
Node 18+ for the global `fetch`). They run identically inside Claude Code,
opencode, CI, or a plain bash shell, and don't pay any MCP handshake / `npx`
startup cost.

The `monday-api-mcp` MCP server registered by this plugin's `.mcp.json` is
still **available as an optional path** — use it only if you need rich
behaviour outside the scripts' surface (e.g. apps-framework mutations, board
schema introspection across many boards).

## Prerequisites

- `MONDAY_TOKEN` must be set in the environment (see the plugin README). When
  it is missing, every script exits 1 with a pointer to the docs — same
  failure mode as the MCP launcher.
- A `mondayBoardId` should be configured in `.claude/scrum-context.json`
  (see `hooks/scrum-context.example.json`, or run the `setup-scrum-context`
  skill to write it). When set, it is injected at session start as
  `<scrum-context><monday-board id="..." /></scrum-context>`, and the
  `list-items` script also falls back to it when invoked with no argument.
  Check the current context for this before asking the user for a board ID.

## Scripts

Run from any cwd with `node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/<script>"`.
Output is **JSON Lines** (one compact JSON object per line for list
operations, a single object for item reads and writes) — stop after one
scripted call rather than looping unless the user asks for more.

| Script | Args | Returns |
|--------|------|---------|
| `list-items.mjs` | `[boardId]` | one item per line: `{id, name, group, status}` |
| `get-item.mjs` | `<itemId>` | one object: `{id, name, group, board, column_values}` |
| `update-item-status.mjs` | `<itemId> "<StatusLabel>"` | one object: `{itemId, boardId, columnId, label, index, updated}` |
| `save-item.mjs` | `<itemId> [outPath]` | one object: `{itemId, outPath, bridge, bytes, saved}`. Persists a pretty-printed JSON snapshot; supports Windows drive paths (`G:\\...`) on WSL via an automatic `powershell.exe` bridge when `/mnt<g>` is not mounted. |
| `save-doc.mjs` | `<docId\|objectId> [outPath]` | one object: `{docId, name, outPath, bridge, bytes, saved}`. Resolves either a doc-column `objectId` or a doc id, renders the doc's blocks as Markdown. |
| `save-updates.mjs` | `<itemId> [outPath]` | one object: `{itemId, outPath, bridge, count, bytes, saved}`. Persists the item's updates (comments) + replies as JSON. |
| `save-all.mjs` | `[boardId] "<groupName>" [epicFolderPath] [--full]` | one object summarizing a bulk snapshot of every item in one board group ("Epic") — see **Epic snapshot layout** below. `boardId`/`epicFolderPath` fall back to `mondayBoardId`/`mondayEpics[groupName]` in `<scrum-context>` when omitted. Incremental by default (skips re-fetching docs/updates for items whose `updated_at` hasn't changed); pass `--full` to force a full re-fetch. |
| `init-task.mjs` | `--item <itemId> [epicFolder]` or `--subitem <subitemId> [epicFolder]` | one object describing the PBI markdown files created and the monday link column(s) written — see **Epic snapshot layout** below. `epicFolder` falls back to `mondayEpics[<item's monday group>]` when omitted. |
| `set-link.mjs` | `<itemId> "<columnTitle>" <url> [text]` | one object: `{itemId, boardId, column, columnId, url, text, updated}`. Overwrites one `link`-typed column by title — used to replace an interim `file://` value with a resolved real link, see **Resolving real Drive links for pbi link columns** below. |
| `check-stale-links.mjs` | `<itemId>` | one object: `{itemId, boardId, staleLinks, ok}`, where `staleLinks` is `[{column, columnId, url}]` for every `link` column still holding a `file://` value. Exit code 4 when `staleLinks` is non-empty — run this after `set-link.mjs` to mechanically confirm no link column was missed, instead of relying on remembering to repeat the recipe for every link column on the item. |

The walking-skeleton end-to-end check is: `get-item.mjs <someId>` prints one
item's name + status. You don't need to dump the whole board.

## Epic snapshot layout

`save-all.mjs` and `init-task.mjs` manage a per-Epic folder (an Epic = one
board group) with this fixed layout — this is the authoritative reference:

```
<epicFolder>/
  design/                                 # manual, whole-Epic design docs — save-all.mjs never touches this
  .pm/                                    # dot-prefixed: single root for all machine-managed
                                          # Epic data (backlog snapshot, repo sync data,
                                          # AI reports, summary) — see scripts/lib/layout.mjs
    backlog/
      items/<itemId>.json                  # save-all.mjs, always overwritten, id-only
      docs/<docId>.md                      # save-all.mjs, always overwritten, id-only
      updates/<itemId>.json                # save-all.mjs, always overwritten, id-only
      progress-history.json                # generate-progress-report.mjs
    repo/                                  # sync-repo.mjs — see README's "Repository sync" section
    reports/
      progress/progress-report-<date>.html # generate-progress-report.mjs
  prd/
    prd.md                                 # save-all.mjs, generated once, never overwritten
                                            # (a folder, since more than one PRD can accumulate)
  pbi/<itemId>-<name>/
    acceptance.md                          # init-task.mjs --item, generated once
    tasks.md                               # init-task.mjs --item, only when the item has no subitems
    evidence/README.md                     # init-task.mjs --item, generated once — acceptance-test evidence
    sub-tasks/<subitemId>-<name>.md        # init-task.mjs --subitem, one per subitem
```

A legacy Epic that still has `.snapshots/` instead of `.pm/` needs a one-time
migration — run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/migrate-epic-layout.mjs" "<groupName>"`.
`save-all.mjs` and `generate-progress-report.mjs` refuse to run (a JSON error,
not a silent partial write) against an Epic that still has `.snapshots/` and
no `.pm/` yet.

`<name>` is only appended for `pbi/` / `sub-tasks/` (human-curated,
create-once files) — `.pm/backlog/*` stays id-only since it is fully
overwritten every `save-all.mjs` run, and embedding a mutable name there
would leave stale orphaned files behind after a monday rename. For `pbi/` /
`sub-tasks/`, `<name>` is resolved once via `resolveIdPrefixedEntry` (in
`monday-client.mjs`): a later rename in monday does **not** rename the
folder/file — only the id prefix is relied on to find it again, so re-running
`init-task.mjs` after a monday rename still reuses the original entry instead
of creating a duplicate.

`init-task.mjs` writes each generated file's path back into the item's/
subitem's **`link`-typed column, resolved by column title** ("Acceptance
Criteria" / "Tasks" on the item; the sole `link` column on a subitem) —
monday generates a random id suffix per board (e.g. `link_mm4y5g57`), so
never assume a column id is stable across boards.

## Resolving real Drive links for pbi link columns

`init-task.mjs` only ever writes a best-effort `file:///G:/...` URI (built by
its local `toFileUri()`) into the link column — this is clickable *only* on
a machine where that exact Drive-letter/sync path exists, so it is not a
real, portable link. Once the generated file has synced up to Google Drive,
it has a real `https://drive.google.com/...` link that should replace the
`file://` one.

Resolve it with the (already-connected) Google Drive MCP connector's
`search_files` tool — this needs only the monday **itemId**, no local path
parsing:

1. `search_files({query: "title contains '<itemId>' and mimeType = 'application/vnd.google-apps.folder'"})`
   → finds the pbi folder (e.g. title `"12445363659-Item 2"`). **Filter the
   results** so the folder's `title` starts with `<itemId>-` or equals
   `<itemId>` exactly — plain substring `contains` can false-positive when
   one itemId is a numeric substring of another (e.g. searching `445363`
   would also match a folder prefixed `12445363658`). If more than one
   folder still matches after that filter, stop and ask the user rather than
   guessing.
2. `search_files({query: "parentId = '<folderId>' and title = 'acceptance.md'"})`
   (or `'tasks.md'`, or a subitem's `<subitemId>-<name>.md`) → take the
   returned `viewUrl` directly as the real link. No `get_file_metadata` call
   is needed. If more than one file matches, surface both to the user
   instead of picking one arbitrarily.
3. `node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/set-link.mjs" <itemId> "Acceptance Criteria" "<viewUrl>" "pbi/<itemId>-<name>/acceptance.md"`
   to overwrite the column with the real link. **Repeat steps 2–3 for every
   other `link` column `init-task.mjs` wrote** — in item mode this is
   normally twice (once for `"Acceptance Criteria"` / `acceptance.md`, once
   for `"Tasks"` / `tasks.md`); a subitem has exactly one `link` column,
   matched by type rather than title.
4. `node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/check-stale-links.mjs" <itemId>`
   to confirm none of the item's link columns still hold a `file://` value.
   A non-zero exit lists the offending columns in `staleLinks` — repeat
   steps 1–3 for those columns and re-run this check before considering the
   item done. Don't skip this: it is the deterministic way to catch a missed
   column instead of relying on memory.

**Fallback:** if step 1 returns zero folders, the file hasn't synced to
Google Drive yet (Drive for desktop mirrors asynchronously), or the Drive
MCP connector isn't reachable. Leave the existing `file://` value in place,
tell the user it's interim, and retry this resolution later — don't fail
the whole `init-task.mjs` workflow on this. This step is optional/best-effort
and depends on the Google Drive MCP connector being connected — the same
"reach for MCP only for the one thing the dependency-free scripts can't do"
posture as the `monday-api-mcp` escape hatch below, just naming the Drive
connector instead (the same read-only connector referenced in the
`manage-drive-docs` skill).

## Steps

1. **Read the board:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/list-items.mjs"`
   — pass a `<boardId>` only if none is present in `<scrum-context>`. The
   script emits `{id, name, group, status}` per item; render that summary to
   the user.
2. **Read a single item:** `get-item.mjs <itemId>` — for the walking-skeleton
   minimum, fetching and displaying one item's name + status is enough.
3. **Update status:** confirm the target item and the new status label with
   the user before running `update-item-status.mjs <itemId> "<Label>"` —
   monday.com changes are visible to the whole workspace. If the label isn't
   found, the script prints the board's accepted labels on stderr; pass one
   of those back to the user and retry.
4. **Persist an item snapshot** to Google Drive or another location:
   `save-item.mjs <itemId> "<outPath>"`. Falls back to a `powershell.exe`
   bridge for Windows drive paths on WSL where the drive is not mounted at
   `/mnt/<drive>`. The output JSON is pretty-printed (multi-line) so it is
   easy to diff across runs.
5. **Set up or refresh an Epic folder:** `save-all.mjs "<groupName>"` (add
   `<boardId>`/`<epicFolder>` explicitly only if not already configured in
   `mondayBoardId`/`mondayEpics` in `.claude/scrum-context.json`)
   bulk-fetches every item in that group plus attached docs/updates into
   `.pm/backlog/`, and generates `prd/prd.md` once (never overwritten
   afterwards — safe to re-run repeatedly to refresh snapshots; add `--full`
   to force re-fetching docs/updates for every item instead of only changed
   ones).
6. **Start work on a PBI:** confirm the item/subitem with the user, then
   `init-task.mjs --item <itemId>` (or `--subitem <subitemId>`) to scaffold
   its `acceptance.md` / `tasks.md` / `evidence/` / `sub-tasks/<id>-<name>.md`
   and link them back on the board — `epicFolder` is only needed explicitly
   if `mondayEpics` doesn't have an entry for the item's monday group. Like
   `update-item-status.mjs`, this writes to monday.com without prompting
   again — confirm with the user first. Afterwards, follow up with
   **Resolving real Drive links for pbi link columns** (above) to replace
   the interim `file://` value with a real Drive link once the file has
   synced — don't leave the stale `file://` link as the final state if a
   real one can be resolved. That recipe's final step runs
   `check-stale-links.mjs <itemId>` for you — treat a non-zero exit there as
   the signal that a column (e.g. "Tasks") was missed, not just the prose
   reminder in this step.
7. **Fix a stale `file://` link on an already-created item:** if
   `get-item.mjs <itemId>` (or `list-items.mjs`) shows a link column's
   `column_values` holding a `file:///...` value, the itemId alone is enough
   to resolve a real link — run the same **Resolving real Drive links**
   recipe above (both queries use only the itemId, not the stale URL) and
   call `set-link.mjs` to overwrite it. No need to parse the stale `file://`
   path at all.

## Optional: the `monday-api-mcp` MCP server

Only reach for MCP if a request genuinely exceeds the scripts above (rich
mutations, apps/atp mode tooling). In that case:

1. Confirm `monday-api-mcp` is connected (`/mcp`).
2. The exposed tool names differ by startup mode (`api` / `apps` / `atp`);
   this plugin launches it in default mode. List the currently available
   `mcp__monday-api-mcp__*` tools before assuming a name — don't hardcode one
   from memory.

## Failure modes

- **`MONDAY_TOKEN` not set**: every script exits 1 with the doc URL. Point the
  user to https://developer.monday.com/api-reference/docs/authentication.
- **No board id available**: pass one explicitly, or use the
  `setup-scrum-context` skill to add `mondayBoardId` to
  `.claude/scrum-context.json`. `list-items.mjs` exit code is 2 here.
- **Unknown status label**: exit code 3; the accepted labels are listed on
  stderr — pass them back to the user.
- **HTTP / GraphQL error**: surfaced verbatim on stderr with exit code 1.
- **Drive file not found for `search_files`**: the pbi folder/file hasn't
  synced from local disk to Google Drive yet (Drive for desktop mirrors
  asynchronously), or the Drive MCP connector isn't reachable. Leave the
  existing `file://` (or prior) link in place and retry later — don't fail
  the whole workflow on this.
- **`check-stale-links.mjs` reports stale links**: exit code 4; `staleLinks`
  in the printed JSON lists the offending `{column, columnId, url}` entries.
  Re-run the **Resolving real Drive links** recipe for each listed column,
  then re-run `check-stale-links.mjs` until it exits 0 — don't consider the
  item done while it's still non-zero.
- **`set-link.mjs` "no link-typed column titled X"**: the board's column was
  renamed away from "Acceptance Criteria"/"Tasks" (or another title was
  passed). The script lists the board's actual `link`-typed column titles on
  stderr (exit code 3) — pass the correct title back.