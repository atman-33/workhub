---
name: manage-drive-docs
description: Search, read, edit, or reorganize (rename/move/delete/list folders) development documentation and its folder structure stored in Google Drive, by accessing the locally synced folder (Google Drive for desktop) directly through the filesystem. Use when the user asks about design docs, specs, or other development documentation kept in Google Drive rather than in the repo, or wants to rename/move/delete files or folders there.
---

# Development docs on Google Drive (local sync)

Walking-skeleton workflow for finding, reading, and **editing** development
documentation kept in Google Drive, by going through the local filesystem
folder that Google Drive for desktop syncs. No MCP server is used — the
agent reads/writes the synced files directly with the standard file tools
(`Read`, `Edit`, `Write`, `Glob`, `Grep`) for content, and the
`drive-fs.mjs` script (below) for folder/file *management* (rename, move,
delete, list) on WSL where a hand-rolled `powershell.exe` command gets
subtly wrong. This means docs can be edited and saved back, which the
read-only Google Drive MCP connector cannot do.

## Prerequisites

- **Google Drive for desktop** must be installed and the relevant docs
  folder must be **synced to the local filesystem** (mirroring, not
  streaming-only). Confirm in Drive for desktop settings that the folder is
  set to "Mirrored sync" or that the files have been made available offline.
- A `driveDocsRootPath` should be configured in `.claude/scrum-context.json`
  (see `hooks/scrum-context.example.json`, or run the `setup-scrum-context`
  skill to write it). When set, it is injected at session start as
  `<scrum-context><drive-docs-root path="..." /></scrum-context>` — check the
  current context for this before asking the user for a path.

### Path format by environment

- **Windows native**: use the Windows path verbatim, e.g. `G:\\マイドライブ`
  (escape backslashes in JSON) or `G:\\共有ドライブ\\チームX` for a shared
  drive. A single root or an array of roots is accepted.
- **WSL**: access the same drive through `/mnt/<drive>/...`, e.g.
  `/mnt/g/マイドライブ`. NTFS-mounted paths can interact poorly with
  non-ASCII folder names under WSL — the mount can be entirely unreachable
  (`Read`/`Edit`/`Write` report "file does not exist" even though the file is
  there). If that happens, use `drive-fs.mjs read`/`write` (see below) instead
  of the standard tools — no need to switch to Windows native Claude or
  rename the folder first. The skill does not auto-rewrite paths between
  forms; set the form that matches the environment Claude is running in.

## Steps

1. If `driveDocsRootPath` is available from `<scrum-context>`, scope searches
   to that root. When multiple roots are configured, ask the user which one
   (or search them in turn). If none is configured, ask the user for the
   absolute path to the synced Drive folder.
2. Find candidate documents:
   - `Glob` with a pattern like `<root>/**/*.md` for files by name/extension.
   - `Grep` across `<root>` to match content (titles, keywords).
3. Read the document with `Read`. For native Google Docs/Sheets/Slides, the
   synced copy on disk is the rendered `.gdoc`/`.gsheet`/`.gslides` shortcut
   bundle, **not** the full content — those formats are not regular files on
   disk and cannot be read this way. Restrict this workflow to normal file
   types stored in Drive (`.md`, `.txt`, `.docx`, `.pdf`, etc.). If `Read`
   fails on a non-ASCII WSL path (see "Path format by environment" above),
   use `node "${CLAUDE_PLUGIN_ROOT}/scripts/drive/drive-fs.mjs" read <path>`
   instead — it returns `{path, ok, bridge, content}`.
4. Edit with `Edit` (or `Write` for new files) directly under the synced
   root. Saves go to the local sync folder and propagate back to Drive. If
   `Edit`/`Write` fail on the same non-ASCII WSL path, pipe the full new
   content on stdin to
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/drive/drive-fs.mjs" write <path>`
   instead.
5. For a minimal end-to-end check ("walking skeleton"), finding, reading,
   and saving one plain-text document is sufficient.

## Folder/file management, and content when the standard tools can't reach it

For structural operations — renaming/moving a folder, deleting something, or
listing a directory whose entries include non-ASCII names — use
`node "${CLAUDE_PLUGIN_ROOT}/scripts/drive/drive-fs.mjs" <subcommand> ...`
instead of hand-writing a `powershell.exe` command; `Read`/`Edit`/`Write`
cannot do any of this. The same script's `read`/`write` subcommands are the
fallback for file *content* specifically when `Read`/`Edit`/`Write` fail on a
non-ASCII WSL path that won't mount cleanly under `/mnt/<drive>` — prefer the
standard tools when they work, and reach for `drive-fs.mjs` only once they've
failed. It transparently uses the same `/mnt/<drive>` → `powershell.exe`
UNC-bridge fallback as the rest of the `scrum` plugin's Drive tooling, and
fixes three mistakes a hand-rolled command makes silently:

| Subcommand | Args | Returns |
|---|---|---|
| `list` | `<dirPath>` | one JSON object per entry: `{name, isDirectory}` |
| `exists` | `<path>` | `{path, exists}` |
| `mkdir` | `<dirPath>` | `{path, ok, bridge}` |
| `move` | `<fromPath> <toPath>` | `{from, to, ok, bridge}` (rename or move) |
| `delete` | `<path>` | `{path, ok, bridge}` — **exactly one explicit path** |
| `read` | `<path>` | `{path, ok, bridge, content}` — file content, not just structure |
| `write` | `<path>` | `{path, ok, bridge}` — content is read from **stdin**, not an arg |

1. **Non-ASCII filenames garble unless you use this script.** Windows
   PowerShell 5.1's default console encoding is not UTF-8, so a directory
   listing containing Japanese (or other non-ASCII) names comes back
   corrupted once captured through Node — `drive-fs.mjs list` already forces
   `[Console]::OutputEncoding` to UTF-8 before listing; a hand-written
   `Get-ChildItem` will not, and the corruption is easy to miss until
   something downstream (a rename, a link) silently targets the wrong path.
2. **Never build a bulk/pattern-based `delete`.** No loop over multiple
   paths, no wildcard, no "delete everything except X" — Claude Code's
   auto-mode classifier blocks pattern-based bulk destructive operations on
   Drive content (learned the hard way: a "keep-list" delete loop over a
   directory was blocked mid-session). Always resolve the exact target first
   with `list`, confirm it with the user if there is any doubt it's the
   right one, then call `delete` with that one literal path.
3. **Never pipe non-ASCII file content through a hand-rolled
   `powershell.exe Get-Content` and capture its stdout.** It garbles even
   with `[Console]::OutputEncoding` forced to UTF-8. `drive-fs.mjs read`
   avoids this by copying the file as bytes to a local temp file and reading
   that instead — don't reimplement the stdout-capture approach yourself.

## Failure modes

- **Path not found / file unreadable**: confirm the folder is mirrored (not
  streaming-only). In Google Drive for desktop, right-click the file or
  folder → "Make available offline" (or set the parent to Mirrored sync),
  then re-run. Streaming-only placeholder files cannot be read by `Read`.
- **No root path configured**: fall back to asking the user for the absolute
  path to the synced Drive folder, or run the `setup-scrum-context` skill to
  add `driveDocsRootPath` to `.claude/scrum-context.json`.
- **Native Google Docs/Sheets/Slides**: those are shortcut bundles on disk,
  not readable/editable files. Open them in the browser instead, or export a
  plain-text format to the synced folder and edit that.
- **WSL encoding issues with non-ASCII paths**: for *content* (`Read`/`Edit`/
  `Write`), first try `drive-fs.mjs read`/`write` (above) instead — it copies
  file bytes through the powershell bridge rather than mounting or piping
  text, so it isn't affected by this. Fall back to Windows native Claude or
  an ASCII-only folder name under `/mnt/<drive>/` only if `powershell.exe`
  itself is unreachable (e.g. no WSL interop). For *listing/renaming/moving/
  deleting* folders with non-ASCII names, use `drive-fs.mjs` (above) as
  well — it already forces the UTF-8 console encoding fix, so this failure
  mode does not apply to it.