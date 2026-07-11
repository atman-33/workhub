---
name: setup-scrum-context
description: Set up or update .claude/scrum-context.json for a project — the monday.com board, Google Drive docs root, and Epic-to-Drive-folder mappings the scrum plugin's other skills and scripts depend on. Use when the user wants to configure monday/Drive settings for a project, or when manage-monday-backlog/manage-drive-docs report no board id or no Drive root configured.
---

# Set up scrum context for this project

`scrum` is installed at user scope, so it works in any repo, but each repo
still needs its own `.claude/scrum-context.json` — this skill creates or
updates that file without hand-editing JSON.

## Steps

1. Take the current working directory as the target project root (it's the
   repo the user is already working in). Only ask if that's ambiguous.
2. Read `.claude/scrum-context.json` if it exists and show the user its
   current values, so you only ask about what's missing or changing:
   - `mondayBoardId` / `mondayBoardUrl` — the monday.com board
   - `driveDocsRootPath` — Google Drive root(s) for `manage-drive-docs` (a
     string or array of strings)
   - `mondayEpics` — `{ "<monday group title>": "<Drive Epic folder path>" }`
     entries used by `save-all.mjs` / `init-task.mjs`, and also injected into
     `<scrum-context>` as `<monday-epic>` elements. A value may also be an
     object — `{drivePath, repo: {url, epicBranch?, defaultBranch?}}` — to
     additionally configure `sync-repo.mjs`'s dedicated mirror clone for that
     Epic; `repo.epicBranch` is optional (auto-detected from `epic/*` remote
     branches when omitted).
   - `repoWorkspacesRoot` — local (non-Drive) root directory `sync-repo.mjs`
     clones repo mirrors under, default `~/.pm-repos`
3. Extract the numeric board id from the URL's `/boards/<id>` segment when
   the user gives a monday board URL.
4. When adding or changing a `mondayEpics` entry, check that the existing
   `driveDocsRootPath` is an ancestor of the new folder path. `manage-drive-docs`
   only searches under `driveDocsRootPath`, so an Epic folder outside it becomes
   invisible to Drive lookups even though `save-all.mjs`/`init-task.mjs` (which
   read `mondayEpics` directly) still work. If it isn't an ancestor, point this
   out to the user and offer to broaden `driveDocsRootPath` to the common parent
   of all `mondayEpics` folders (see README's `driveDocsRootPath`/`mondayEpics`
   note) rather than silently leaving it scoped to one Epic.
5. Write the patch in one call — do not hand-edit the JSON file yourself:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/init-scrum-context.mjs" <<'EOF'
   {"mondayBoardId": "...", "mondayBoardUrl": "...", "driveDocsRootPath": "...", "mondayEpics": {"...": "..."}, "repoWorkspacesRoot": "..."}
   EOF
   ```
   Omit any key the user isn't setting. The script merges onto the existing
   config (`mondayEpics` merges key-by-key, so prior entries survive) and
   ensures `.claude/scrum-context.json` is listed in `.gitignore`.
6. Report the script's JSON result to the user: which fields were written,
   whether `.gitignore` was updated, and whether `MONDAY_TOKEN` is set in the
   environment (a courtesy check — point to
   https://developer.monday.com/api-reference/docs/authentication if not).
7. Tell the user a new session is needed: the `<scrum-context>` block is only
   injected by the SessionStart hook, so this session won't see the change
   until they restart.

## Reference

Full field meanings and the `<scrum-context>` XML the SessionStart hook
produces are documented in the `scrum` plugin README's "SessionStart hook"
section and `hooks/scrum-context.example.json` — this skill only automates
writing the file; it doesn't change what the fields mean.
