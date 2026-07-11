# scrum

Helpers for scrum and agile development workflows. Currently ships an
experimental walking-skeleton integration for:

1. **Product backlog on monday.com** — walking-skeleton scope is served by
   dependency-free CLI scripts (no MCP handshake, no `npx` startup) talking
   directly to the monday.com GraphQL v2 API; the official `monday-api-mcp`
   MCP server is also shipped as an optional path for richer operations.
2. **Development docs on Google Drive** — read and edited directly through the
   local filesystem folder that **Google Drive for desktop** syncs (no MCP
   server). This enables editing docs and saving them back to Drive, which the
   read-only Drive MCP connector cannot do.

## Components

### MCP server: monday.com backlog

The plugin ships an `.mcp.json` that registers one MCP server:

| Server | Role |
|--------|------|
| `monday-api-mcp` | Read/write access to monday.com boards ([@mondaydotcomorg/monday-api-mcp](https://github.com/mondaycom/mcp)). |

```json
{
  "mcpServers": {
    "monday-api-mcp": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/monday-api-mcp-launcher.mjs"]
    }
  }
}
```

The server is started through
[`mcp/monday-api-mcp-launcher.mjs`](mcp/monday-api-mcp-launcher.mjs), which
prefers a global npm install and otherwise falls back to `npx` (branching on
`process.platform` at runtime, so **one `.mcp.json` works on both Windows and
WSL**, same pattern as the `engineering` plugin's launchers).

#### CLI scripts (primary path for the walking-skeleton scope)

For list / read-one / update-status workflows, the plugin ships
**dependency-free CLI scripts** under [`scripts/monday/`](scripts/monday).
They talk to the monday.com GraphQL v2 API directly and work the same inside
Claude Code, opencode, CI, or a plain bash shell — no MCP handshake, no `npx`
startup cost. Reach for the MCP server below only when you need behaviour
outside this surface.

| Script | Args | Returns |
|--------|------|---------|
| `scripts/monday/list-items.mjs` | `[boardId]` (defaults to `mondayBoardId` from `<scrum-context>`) | JSON Lines: `{id, name, group, status}` per item |
| `scripts/monday/get-item.mjs` | `<itemId>` | one JSON object: `{id, name, group, board, column_values}` |
| `scripts/monday/update-item-status.mjs` | `<itemId> "<StatusLabel>"` | one JSON object: `{itemId, boardId, columnId, label, index, updated}` |
| `scripts/monday/save-item.mjs` | `<itemId> [outPath]` (defaults to `./monday-item-<itemId>.json`) | one JSON object: `{itemId, outPath, bridge, bytes, saved}`. Writes a pretty-printed JSON snapshot to disk; falls back to a `powershell.exe` bridge when `outPath` is a Windows drive path (`G:\\...`) on WSL where the drive is not mounted. |
| `scripts/monday/save-doc.mjs` | `<docId\|objectId> [outPath]` | one JSON object: `{docId, name, outPath, bridge, bytes, saved}`. Resolves a doc-column `objectId` or a doc id and renders the doc's blocks as Markdown. |
| `scripts/monday/save-updates.mjs` | `<itemId> [outPath]` | one JSON object: `{itemId, outPath, bridge, count, bytes, saved}`. Persists the item's updates (comments) + replies as JSON. |
| `scripts/monday/save-all.mjs` | `[boardId] "<groupName>" [epicFolderPath]` (boardId/epicFolderPath default to `mondayBoardId`/`mondayEpics[groupName]` from `<scrum-context>`) | one JSON object summarizing a bulk snapshot of every item in one board group — see **Epic snapshot layout** below. |
| `scripts/monday/init-task.mjs` | `--item <itemId> [epicFolder]` or `--subitem <subitemId> [epicFolder]` (epicFolder defaults to `mondayEpics[<item's monday group>]`) | one JSON object describing the PBI markdown files created and the monday link column(s) written — see **Epic snapshot layout** below. |

```sh
node plugins/scrum/scripts/monday/list-items.mjs 1234567890
node plugins/scrum/scripts/monday/get-item.mjs 9876543210
node plugins/scrum/scripts/monday/update-item-status.mjs 9876543210 "Done"
node plugins/scrum/scripts/monday/save-item.mjs 9876543210 "G:\\マイドライブ\\projects\\workhub\\.pm\\backlog\\items\\9876543210.json"
node plugins/scrum/scripts/monday/save-all.mjs 1234567890 "My Epic" "G:\\マイドライブ\\projects\\workhub"
node plugins/scrum/scripts/monday/save-all.mjs "My Epic"   # once mondayEpics/mondayBoardId are configured
node plugins/scrum/scripts/monday/init-task.mjs --item 9876543210 "G:\\マイドライブ\\projects\\workhub"
node plugins/scrum/scripts/monday/init-task.mjs --item 9876543210   # once mondayEpics is configured
```

The shared [`scripts/monday/monday-client.mjs`](scripts/monday/monday-client.mjs)
resolves the board id the same way the SessionStart hook resolves the project
root (`CLAUDE_PROJECT_DIR` → stdin `cwd` → `process.cwd()`), then reads
`.claude/scrum-context.json`, so `list-items.mjs` runs with no args whenever
a board id is configured. Output is one JSON object per line (JSON Lines),
which is easy for callers (`jq`, CI wrappers, the skill body) to parse. It also
exports the read helpers shared by `save-item.mjs` / `save-doc.mjs` /
`save-updates.mjs` / `save-all.mjs` (`fetchItemSnapshot`, `fetchDocMarkdown`,
`fetchItemUpdates`), so bulk and single-item fetching stay behaviorally
identical.

#### Repo sync & layout scripts

Beyond the monday scripts, two more dependency-free CLIs manage the Epic
folder's machine data (paths for all of them resolve through
[`scripts/lib/layout.mjs`](scripts/lib/layout.mjs), the single source of
truth for the `.pm/` layout below):

| Script | Args | Returns |
|--------|------|---------|
| `scripts/repo/sync-repo.mjs` | `"<groupName>"` (+ optional `--epic-folder` / `--repo-url` / `--epic-branch` / `--default-branch` / `--workspaces-root` overrides) | one JSON object. Token-free git sync of the Epic's development repo into `.pm/repo/`: manages a dedicated local clone under `repoWorkspacesRoot`, resolves the epic branch (config → newest `epic/*` → default branch), appends new commits to `commits.jsonl` incrementally (only commits since the previous run's `lastSyncedSha`), and overwrites `repo-state.json` / `branch-diff.json` / `branches.json`. Safe to run as often as you like — it consumes no AI tokens and no monday API calls. |
| `scripts/setup/migrate-epic-layout.mjs` | `"<groupName>"` or an explicit epic folder path | one JSON object. Idempotently migrates a pre-`.pm` Epic folder: `.snapshots/{items,docs,updates}` → `.pm/backlog/`, `progress-history.json` → `.pm/backlog/`, `progress-report-*.html` → `.pm/reports/progress/`. |

#### Epic folder layout

`save-all.mjs`, `init-task.mjs`, and `sync-repo.mjs` manage a per-Epic folder
(one Epic = one board group) with this fixed layout:

```
<epicFolder>/
  design/                                 # manual, whole-Epic design docs — scripts never touch this
  .pm/                                    # dot-prefixed: ALL machine-managed data lives here
    backlog/
      items/<itemId>.json                  # save-all.mjs, always overwritten, id-only
      docs/<docId>.md                      # save-all.mjs, always overwritten, id-only
      updates/<itemId>.json                # save-all.mjs, always overwritten, id-only
      progress-history.json                # generate-progress-report.mjs, one entry per day
    repo/
      repo-state.json                      # sync-repo.mjs: repoUrl, mirrorPath, epicBranch, lastSyncedSha, lastSyncAt
      commits.jsonl                        # sync-repo.mjs: epic-branch commits, append-only/incremental
      branch-diff.json                     # sync-repo.mjs: epic branch vs default branch (ahead/behind, diffstat, files)
      branches.json                        # sync-repo.mjs: feature branches around the epic branch
    reports/
      progress/progress-report-<date>.html # generate-progress-report.mjs
      spec/                                # report-epic-spec skill
      spikes/                              # investigate-spike skill
      audits/                              # audit-epic-consistency skill
    summary.md                             # AI-maintained Epic summary (load-epic-context)
  prd/
    prd.md                                 # save-all.mjs, generated once, never overwritten
                                            # (a folder, since more than one PRD can accumulate)
  pbi/<itemId>-<name>/
    acceptance.md                          # init-task.mjs --item, generated once
    tasks.md                               # init-task.mjs --item, only when the item has no subitems
    evidence/README.md                     # init-task.mjs --item, generated once — acceptance-test evidence
    sub-tasks/<subitemId>-<name>.md        # init-task.mjs --subitem, one per subitem
```

`<name>` is only appended under `pbi/` / `sub-tasks/` — human-curated,
create-once files where a name baked in at creation time stays useful even
after a later monday rename. `.pm/backlog/*` stays id-only since it is fully
overwritten every `save-all.mjs` run. `resolveIdPrefixedEntry` (in
`monday-client.mjs`) resolves an existing `pbi/<id>-*` or `sub-tasks/<id>-*`
entry by id prefix so a rename in monday never creates a duplicate folder.

Epic folders created before v0.16.0 used `.snapshots/` instead of `.pm/`;
`save-all.mjs` and `generate-progress-report.mjs` detect the legacy layout
and tell you to run `migrate-epic-layout.mjs` (they never auto-migrate).

The dedicated repo clone lives **locally** under `repoWorkspacesRoot`
(default `~/.pm-repos/`), never inside the Drive Epic folder — Google Drive
sync should never see a `.git` directory. The clone is script-owned: treat it
as read-only, and never point it at your own development checkout.

`init-task.mjs` writes each generated file's path back into the relevant
`link`-typed column, **resolved by column title** ("Acceptance Criteria" /
"Tasks" on the item; the sole `link` column on a subitem) rather than column
id — monday generates a random id suffix per board (e.g. `link_mm4y5g57`),
so column ids are never stable across boards.

#### Requirements

- **Node.js 18+** on `PATH` (the CLI scripts use the global `fetch`). The
  MCP launcher also works on older Node, but the scripts need 18+.
- A monday.com API token in the `MONDAY_TOKEN` environment variable. Get one
  from https://developer.monday.com/api-reference/docs/authentication and
  export it in your shell profile, e.g.:
  ```sh
  export MONDAY_TOKEN=your_token_here
  ```
  The token is never read from a committed file — only from the environment —
  so nothing secret ends up in this repo or your project config.
- For the optional MCP path only: install the server globally for faster
  startup — `npm i -g @mondaydotcomorg/monday-api-mcp`.

If `MONDAY_TOKEN` is missing, the launcher exits with an error explaining how
to set it, and `/mcp` will show `monday-api-mcp` as disconnected.

**Note:** the server's exposed MCP tool names depend on its startup mode
(`api` / `apps` / `atp`). This plugin launches it in the default mode; check
`/mcp` or ask the agent to list `mcp__monday-api-mcp__*` tools rather than
assuming a specific tool name.

### Google Drive docs (local sync)

No MCP server is configured for this — the agent reads and edits the synced
folder directly through the filesystem with the standard `Read`/`Edit`/
`Write`/`Glob`/`Grep` tools. This requires **Google Drive for desktop** to be
installed and the relevant docs folder to be synced (mirroring, not
streaming-only) so the files physically exist on disk.

On **Windows native**, set `driveDocsRootPath` to the Windows path, e.g.
`G:\\マイドライブ` or `G:\\共有ドライブ\\チームX` (escape the backslashes in
JSON). On **WSL**, use the `/mnt/<drive>/...` form, e.g.
`/mnt/g/マイドライブ`. The hook and skill do not auto-rewrite paths between
forms; set the form that matches the environment Claude is running in. A
single string or an array of strings is accepted, so a personal Drive and one
or more shared drives can all be listed under one config.

Native Google Docs/Sheets/Slides are shortcut bundles on disk, not
readable/editable files — this workflow targets normal file types (`.md`,
`.txt`, `.docx`, `.pdf`, etc.) stored in Drive. Streaming-only placeholder
files cannot be read either; right-click the file or folder in Drive for
desktop → "Make available offline" (or set the parent to Mirrored sync) before
reading.

For folder/file *management* (rename, move, delete, list), or for *content*
when the standard tools can't reach a non-ASCII WSL path (the mount can be
entirely unreachable, or reading it back through a hand-written
`powershell.exe` pipe garbles the text), use
[`scripts/drive/drive-fs.mjs`](scripts/drive/drive-fs.mjs) instead of a
hand-written `powershell.exe` command — see the `manage-drive-docs` skill for
the full subcommand table (including `read`/`write`) and the gotchas it
exists to avoid (non-ASCII filename corruption, non-ASCII content corruption,
and Claude Code's auto-mode classifier blocking bulk/pattern-based deletes).

### SessionStart hook: scrum context injection

On every session start, the plugin injects a `<scrum-context>` XML block
containing your configured monday.com board, Google Drive docs root path(s),
and per-Epic Drive folder mappings, so the agent knows where to look without
being told every time. It never nags an unconfigured project — no config file
means nothing is injected.

#### Configuration

Use the `setup-scrum-context` skill to create or update this file — it
merges onto any existing config, extracts the board id from a pasted monday
URL, and adds the file to `.gitignore` for you. To create it by hand instead,
add `.claude/scrum-context.json` in the project root (copy
[`hooks/scrum-context.example.json`](hooks/scrum-context.example.json)):

```json
{
  "mondayBoardId": "1234567890",
  "mondayBoardUrl": "https://your-workspace.monday.com/boards/1234567890",
  "driveDocsRootPath": "G:\\マイドライブ",
  "repoWorkspacesRoot": "C:\\repos\\.pm-repos",
  "mondayEpics": {
    "My Epic Group Name": {
      "drivePath": "G:\\マイドライブ\\projects\\my-epic-folder",
      "repo": {
        "url": "https://github.com/your-org/your-repo",
        "epicBranch": "epic/my-epic"
      }
    },
    "Legacy Epic (string form still works)": "G:\\マイドライブ\\projects\\legacy-epic"
  }
}
```

Each `mondayEpics` value is either a plain string (the Drive Epic folder —
the pre-v0.16.0 form, still fully supported) or an object with `drivePath`
plus an optional `repo` block. `repo.url` enables `sync-repo.mjs` and the
code-aware skills; `repo.epicBranch` pins the Epic development branch
(omit it to auto-detect the newest `epic/*` remote branch, falling back to
the default branch); `repo.defaultBranch` overrides `origin/HEAD` detection.
`repoWorkspacesRoot` (top-level, optional) is where dedicated repo clones are
kept — default `~/.pm-repos/`.

`driveDocsRootPath` accepts either a single string or an array of strings
(e.g. `["G:\\マイドライブ", "G:\\共有ドライブ\\チームX"]`), so a personal
Drive and one or more shared drives can all be listed under one config.
`mondayEpics` maps a monday board group title to the Google Drive Epic
folder `save-all.mjs` / `init-task.mjs` manage — once set, both scripts can
be invoked without an explicit board id / folder path (see the CLI table
above). It is read directly by those scripts, and each entry is also
injected into `<scrum-context>` as a `<monday-epic>` element so the agent
can see the mapping without running a script.

`driveDocsRootPath` and `mondayEpics` serve different scopes and should stay
consistent: `driveDocsRootPath` is the search root `manage-drive-docs` scopes
*all* Drive lookups to, while each `mondayEpics` entry is one specific
Epic's folder *inside* that root. Point `driveDocsRootPath` at the common
ancestor of every `mondayEpics` folder (e.g. `G:\マイドライブ\projects`), not
at one Epic's own folder — otherwise `manage-drive-docs` can only see that
one Epic and silently misses the others. This matters most when one
`.claude/scrum-context.json` is shared across multiple sibling repos (e.g. a
harness-style workspace that has one config for several project checkouts):
each repo gets its own `mondayEpics` entry, but there is still only one
`driveDocsRootPath`, so it must cover all of them. All fields are optional;
omit whichever you don't use. This produces:

```xml
<scrum-context>
  <monday-board id="1234567890" url="https://your-workspace.monday.com/boards/1234567890" />
  <drive-docs-root path="G:\マイドライブ" />
  <monday-epic name="My Epic Group Name" drive-path="G:\マイドライブ\projects\my-epic-folder" />
</scrum-context>
```

`.claude/scrum-context.json` is project-local and typically gitignored (like
`.claude/project-context.json`), since it may point at private board and drive
paths — `setup-scrum-context` adds the `.gitignore` entry automatically.

### Skills

- `manage-monday-backlog` — read (and cautiously write) backlog items on monday.com,
  using the CLI scripts under `scripts/monday/` as the primary path and the
  `monday-api-mcp` MCP server as an optional richer-fallback.
- `manage-drive-docs` — search, read, and edit development docs stored in the
  locally synced Google Drive folder (Google Drive for desktop); also covers
  folder/file management (rename/move/delete/list) via `drive-fs.mjs`.
- `snapshot-pbl-to-drive` — one-shot wrapper around `save-all.mjs` for "back up
  this Epic's PBL data to Drive" style requests; same script and layout as
  `manage-monday-backlog`'s Epic snapshot. **User-invoked only** (`/snapshot-pbl-to-drive`) —
  it does not auto-trigger, since its scope is fully covered by `save-all.mjs`
  documented under `manage-monday-backlog`.
- `setup-scrum-context` — create or update `.claude/scrum-context.json` for a
  project (via `scripts/setup/init-scrum-context.mjs`), since `scrum` is
  usually installed at user scope and each project still needs its own config.
- `prepare-sprint-review` — generate a sprint-review HTML document for an Epic
  (done items with demo pointers from the Epic snapshot, sprint metrics,
  agenda), saved to `<epicFolder>/sprint-reviews/`.
- `refine-backlog` — audit backlog items for refinement gaps (missing
  acceptance criteria/estimates, oversized or vague items), propose concrete
  fixes and splits, and apply what the user approves.
- `write-retrospective` — facilitate a KPT retrospective anchored on board
  facts, save the notes to `<epicFolder>/retrospectives/`, and track action
  items (including follow-up on the previous retro's actions).
- `load-epic-context` — prime a session with an Epic's current state:
  refresh stale backlog/repo data via the scripts, read only the aggregates
  (`summary.md`, history, `branch-diff.json`), and brief the user; maintains
  `.pm/summary.md` as the cheap first-read for the next session.
- `audit-epic-consistency` — cross-check user stories / PBIs / acceptance
  criteria against the actual implementation in the Epic's dedicated clone;
  propose fixes for drift, gaps, and unclear wording; save the audit to
  `.pm/reports/audits/`. (Board-only refinement stays in `refine-backlog`.)
- `investigate-spike` — research a spike item against the dedicated clone
  and save a findings report to `.pm/reports/spikes/`.
- `report-epic-spec` — generate a "what's implemented today vs what's coming
  next" HTML report from the backlog + repo data, saved to
  `.pm/reports/spec/`. **User-invoked only** (`/report-epic-spec`).

`manage-monday-backlog`, `manage-drive-docs`, `load-epic-context`,
`audit-epic-consistency`, and `investigate-spike` are auto-invocable: mention
monday.com/backlog, Drive-hosted docs, an Epic's status, a consistency check,
or a spike and Claude will pull in the relevant skill.

### Scheduled refresh (routine template)

The data layer refreshes without AI tokens (`save-all.mjs` incremental +
`sync-repo.mjs` are plain scripts), so a single scheduled Claude routine can
keep every Epic's `.pm/` folder and reports current. Create it with the
`schedule` skill (or your client's routines UI) using a prompt like:

```
For each Epic configured in .claude/scrum-context.json's mondayEpics
(resolve the scrum plugin root from installed_plugins.json; call it $SCRUM):
1. node "$SCRUM/scripts/monday/save-all.mjs" "<groupName>"
2. If the Epic has a repo configured:
   node "$SCRUM/scripts/repo/sync-repo.mjs" "<groupName>"
3. node "$SCRUM/scripts/report/generate-progress-report.mjs" "<groupName>"
4. Only if step 1-3 summaries show material change since the last run
   (status mix, points, epic branch, or ahead/behind changed): update
   <epicFolder>/.pm/summary.md — ~1 page: goal, current state, key
   decisions, open risks. Otherwise leave it untouched.
Report one line per Epic: items saved/skipped, commits appended, report path.
```

Notes for routine prompts:

- Steps 1–3 are token-free script runs; step 4 is the only AI work and is
  conditional, so an hourly-to-daily cadence stays cheap.
- Skills marked `disable-model-invocation: true` (e.g.
  `snapshot-pbl-to-drive`, `report-pbl-progress`) cannot be invoked by name
  from a routine — that flag requires a human typing the command. Routines
  must run the underlying scripts directly (as above) or `Read` the skill's
  `SKILL.md` by absolute path and follow it.
- `MONDAY_TOKEN` must be available in the routine's environment.

## Status

The walking-skeleton phase (fetch one item, read one doc) is done; the
plugin now covers backlog snapshotting (incremental), token-free repo sync
(`.pm/repo/`), progress/spec/spike/audit reporting, and Epic context loading.
Expect it to keep growing incrementally.
