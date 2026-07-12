# Changelog

## 0.14.0 (2026-07-12)

- Fix "Checkout" on a remote branch in the Repos git graph doing nothing.
  Checking out a remote-tracking ref (e.g. `origin/main`) now switches to the
  local branch that tracks it, creating it if it does not exist yet (git's
  `--guess`/DWIM behavior). Previously it ran `git switch origin/main`, which
  git rejects, so the branch never changed.
- After checking out a branch, if the local branch trails its upstream, a
  confirmation dialog offers to pull (`--ff-only`) — mirroring the VS Code Git
  Graph flow.
- The `origin/HEAD` symref alias no longer offers a (non-functional) Checkout
  action in the graph context menu.

## 0.13.0 (2026-07-12)

- Task edit dialog now saves directly to the task file as the user edits,
  removing the explicit Save and Reset buttons. Changes persist on a 1s
  debounce and again immediately when the dialog closes. Errors are shown in
  the status bar (Plan A / option 1).
- New task creation keeps a single "Create" button; the pre-creation draft is
  still restored from `localStorage` if the dialog is accidentally closed.

## 0.12.0 (2026-07-12)

- Auto-save task dialog drafts to `localStorage` as the user types. If the
  dialog is accidentally closed while creating or editing a task, the in-progress
  input is restored the next time the dialog opens. Drafts are cleared on
  successful save and can be discarded with the new "Reset" button.

## 0.11.1 (2026-07-12)

- Simplify the task dialog by moving infrequently-used fields (Priority, Due,
  and Tags) into an expandable "Optional details" accordion. Existing values
  are summarized on the collapsed trigger and the section opens automatically
  when any optional detail is set.
- Standardize all component, custom-hook, and utility filenames under `src/`
  to lowercase kebab-case (e.g., `TaskDialog.tsx` → `task-dialog.tsx`,
  `useYouTubePlayer.ts` → `use-youtube-player.ts`, `taskBody.ts` →
  `task-body.ts`) and update every import path accordingly.
- Add `.claude/rules/file-naming.md` to enforce the lowercase-kebab-case rule
  for future files under `src/`.

## 0.11.0 (2026-07-12)

- Task dialog controls now use shadcn/ui throughout: Project and Model are
  editable comboboxes (pick a known value or type an arbitrary one) and Due is
  a Popover + Calendar date picker, replacing the native `<input list>` and
  `<input type="date">`. The calendar renders in English regardless of OS
  locale.
- Changing a task's Assignee now clears the Model field, so a stale selection
  from another agent no longer carries over. The Model field is disabled for
  `me` (human) tasks, which launch no AI agent.
- Fix Music continuous playback: when a track ended, the player advanced to the
  next video but stopped immediately. The `currentVideoId` sync effect re-cued
  every id change (`cueVideoById` loads without playing), clobbering the
  load+play that `playNext`/`play` had just done. It now cues only when the
  player is idle (async vault hydration), leaving active playback alone.

## 0.10.0 (2026-07-12)

- Fix shadcn/ui animations: `tw-animate-css` was never imported, so the
  commit-graph sheet now actually slides in/out and dialogs fade/zoom.
- The task dialog's model suggestions for opencode-assigned tasks are now
  fetched from the `opencode models` CLI (cached per app run) instead of a
  hardcoded list; claude-code keeps haiku/sonnet/opus.
- New `task-cli.mjs` script in the workhub plugin (list/start/update/report)
  so agents no longer hand-edit task frontmatter; it preserves bodies
  byte-for-byte, regenerates `_ai/index/tasks.json` on every write, and
  prefers the current directory when it is a vault. The task skills now use
  it as their primary path (plugin 0.6.0).
- Task board polish: tag badges on list rows and kanban cards, due dates
  shown on kanban cards and colored red/amber when overdue/due today, a tag
  filter in the toolbar, and Project suggestions now include repositories
  registered in the Repos view.

## 0.9.1 (2026-07-12)

- Remove leftover references to `agent-harness` (workhub's predecessor
  repository) from plugin docs, skills, and hook examples; examples now use
  neutral project names or refer to "the workspace working directory / vault"
  instead of a fixed repo.

## 0.9.0 (2026-07-12)

- Each repository row in the Repos list gains an inline "Open terminal" icon
  button next to the commit graph button (the context-menu entry remains).

## 0.8.1 (2026-07-12)

- New `vault-setup` skill in the `workhub` plugin: one-shot machine
  onboarding for a workhub vault — checks/installs required software (git,
  Node.js, Claude Code, optionally OpenCode/Obsidian), initializes the vault
  via `vault-init` when missing, walks through the Claude plugin trust setup,
  and runs the OpenCode sync/check scripts.

## 0.8.0 (2026-07-12)

- Tasks gain an optional `model` frontmatter field, editable in the task
  dialog. When set, AI agent launches for the task pass `--model <model>` to
  the agent CLI (works for both Claude Code and OpenCode); when empty the
  agent's own default model is used. Files without the field are unchanged.

## 0.7.0 (2026-07-12)

- Selecting a commit in the commit graph now opens a diff panel showing the
  files changed by that commit (with added/removed line counts) and, per file,
  the unified diff with syntax-highlighted additions and deletions. The
  uncommitted-changes row shows the worktree diff against HEAD the same way.

## 0.6.0 (2026-07-12)

- The commit graph now opens in a slide-in sheet over the Repos list instead
  of replacing the whole view, and each repository row gains an inline commit
  graph icon button (in addition to the existing context-menu entry).

## 0.5.1 (2026-07-11)

- Bundle the previously externally-installed recommended skills directly in the
  workhub marketplace. `productivity` now ships `grilling`, `handoff`, and
  `writing-great-skills`; `engineering` already contained its recommended set,
  so its `install-recommended-skills` wrapper is removed. Both plugins' own
  `install-recommended-skills` skills are deleted, removing the dependency on
  the upstream `mattpocock/skills` repository remaining available.

## 0.5.0 (2026-07-11)

- AI task launches can now open a fresh herdr workspace instead of a plain
  terminal window. A new "Open AI tasks in a fresh herdr workspace" setting is
  enabled by default; when herdr is not installed or workspace creation fails,
  the launch falls back to the legacy terminal command automatically.

## 0.4.2 (2026-07-11)

- Fix task agent launches ignoring the task's `assignee`: OpenCode-assigned
  tasks now launch the configured OpenCode command instead of always launching
  Claude Code. A separate "OpenCode command" setting is added to Settings; the
  existing "AI agent command" is now labeled "Claude Code command".

## 0.4.0 (2026-07-11)

- Tasks can now be archived and deleted from a right-click context menu on
  Kanban cards and list rows. Archiving sets an `archived: true` frontmatter
  flag (the file stays in `tasks/`); archived tasks are hidden from the board
  by default and excluded from AI task listings. A new "Archived" toolbar
  toggle shows them (dimmed, with an `archived` badge) and offers Unarchive.
- Deleting a task moves its Markdown file to the OS recycle bin (restorable,
  never a hard delete) after a confirmation dialog, via the new `delete_task`
  command.
- The `_ai/index/tasks.json` index now carries the `archived` field; the
  `task-list` skill excludes archived tasks by default and `task-start`
  refuses to start them. Existing vaults keep working unchanged — an absent
  flag means not archived (re-run vault init to refresh the template docs).

## 0.3.0 (2026-07-11)

- Task AI sessions now always start in the vault (the agent-harness home)
  instead of the task's repository; the `task-start` skill resolves the
  target repository via the vault's `.claude/project-context.json`. The
  hardcoded `C:/repos/<name>` project-path convention is removed.
- Registered projects are synced into the vault's
  `.claude/project-context.json` on every config save and on vault init
  (merge-safe: hand-edited fields and manually registered entries are
  preserved).
- Vault init skips dev artifacts in the template working copy
  (`node_modules/`, `.claude-plugin-sync-manifest.json`).

## 0.2.5 (2026-07-11)

- Move the configured vault path indicator from the Tasks toolbar to the top
  app bar so it is visible from every tab.

## 0.2.4 (2026-07-11)

- Fix task description not appearing after creation: align the Rust task
  creation body with the vault template parser (`## Description / ## Results`)
  and pass the description body in a single `create_task` call instead of a
  separate follow-up update.

## 0.2.3 (2026-07-11)

- Replace native `<select>` elements in the Tasks view and task dialog with
  shadcn/ui `Select` for consistent theming and better readability.
- Unify Tasks screen labels and vault headers to English for consistent UI
  copy.

## 0.2.2 (2026-07-11)

- Fix `check_vault_path` command argument naming so the frontend's `vaultPath`
  is correctly received by the Rust backend.
- Add error handling around the vault existence check so a failure shows the
  vault selection prompt instead of leaving the Tasks view blank.

## 0.2.1 (2026-07-11)

- Fix vault-path handling on startup: only prompt for a vault folder when the
  configured path is missing or no longer exists; otherwise load tasks
  immediately.
- Keep the app-level Settings dialog in sync when a vault folder is chosen from
  the Tasks view, preventing accidental overwrite of the vault path on the next
  Settings save.
- Skip starting the file watcher on startup when the configured vault path does
  not exist.

## 0.2.0 (2026-07-11)

- Music player (new Music tab), ported from
  [tube-loop-player](https://github.com/atman-33/tube-loop-player): add
  YouTube videos by URL (title fetched via oEmbed), multiple playlists
  (create/rename/delete/clear, drag & drop reordering), loop all/one and
  shuffle playback. Playback keeps running while switching tabs.
- Playlists are persisted in the vault at `_ai/music/playlists.json`
  (no cloud sync; the vault is the source of truth).

## 0.1.0 (2026-07-11)

- Initial release, scaffolded from [devdeck](https://github.com/atman-33/devdeck)
  v0.5.0 (its repository-management features live in the Repos tab).
- Task management MVP: tasks stored as Markdown + frontmatter in a dedicated
  Obsidian vault; list/kanban views with drag & drop (status change and manual
  ordering via the `order` field); filters; live sync via file watching;
  `_ai/index/tasks.json` machine index.
- Launch Claude Code / OpenCode on a task in its target repository (vault
  fallback for tasks without a project).
- Bundled Claude Code marketplace + `workhub` plugin (`task-list`,
  `task-start`, `task-report`, `vault-init` skills; report-reminder and
  vault-write-guard hooks) and the vault template.
- App-level settings, self-update from GitHub Releases, dark-native controls,
  new app icon.
