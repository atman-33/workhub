# Changelog

## 0.39.0 (2026-07-18)

- **Voice input**: a new global hotkey (`Ctrl+Shift+Space` by default) starts
  and stops local speech-to-text dictation — press once to record, press
  again to transcribe and paste the result into whatever app currently has
  focus (clipboard + simulated Ctrl+V, with the previous clipboard content
  restored afterward). Transcription runs fully offline via `whisper-rs`
  (whisper.cpp), with no cloud calls and no LLM. A small always-on-top,
  non-focusable indicator shows recording (with elapsed time), transcribing,
  or an error, auto-hiding after idle. Configure the hotkey, model
  (`tiny`/`base`/`small`, downloaded on demand and SHA-1 checksum-verified),
  and language in the new **Settings → Voice** tab; documented in the Help
  tab's new Voice Input section.
  - **Live preview**: audio is split into speech chunks (cut on ~600ms of
    trailing silence, or force-cut at 15s) and transcribed as you speak
    instead of only once at stop, so stopping only pays for the tail chunk's
    latency. Each chunk carries the tail of the running transcript as
    whisper's initial prompt so wording stays consistent across chunk
    boundaries. The indicator grows from a small pill into a live preview
    panel showing the accumulated transcript, auto-scrolled to the latest
    text, and shrinks back to the pill on idle or error.
  - **Draggable indicator with remembered position**: the indicator can be
    dragged anywhere on screen; its position is persisted and restored on
    the next recording (falling back to the previous bottom-center placement
    if the saved spot no longer overlaps a connected monitor).

## 0.38.0 (2026-07-18)

- **Settings dialog**: the settings screen no longer grows past the viewport as
  options accumulate. It now caps at 85vh with a fixed header and footer (Save /
  Reset stay reachable) and a single scrollable body, and its fields are split
  into **General / Commands / Vault** tabs for scannability. A shared `max-h`
  guard on `DialogContent` keeps any dialog from overflowing the screen, and a
  new `Tabs` UI primitive backs the tabbed layout. The tab body has a fixed
  height so the tab bar stays put when switching tabs.
- **Help tab**: Initial setup now opens with a prerequisite-software step
  (git, Node.js, Claude Code required; Obsidian, OpenCode, and herdr optional)
  and points at the `vault-setup` skill as the automated path. The
  plugin-install step is now a complete manual reference — it lists every
  required plugin (`workhub`, `engineering`, `productivity`, `obsidian`) with
  the correct scope, instead of omitting `workhub` while redundantly
  reinstalling the template's pre-enabled plugins. Each section now has a
  **Copy section** button, and the page header has a **Copy all** button, so
  the guide's steps and commands can be pasted straight into an AI agent
  instead of retyped.

## 0.37.0 (2026-07-18)

- **Help tab**: a new **Help** tab (right of Timer) documents the operations
  and setup that aren't discoverable from the UI — first-run vault/plugin/repo
  setup, screen annotation (ink: double-press Alt + hold, `Alt+S` to cycle
  color), and quick capture (`Ctrl+Alt+N`). A path-scoped rule
  (`.claude/rules/help-screen.md`) and a CLAUDE.md note keep the guide in sync
  when these behaviors change.

## 0.36.0 (2026-07-18)

- Tasks: **priority** is now a first-class, one-click control. It renders as a
  small color-coded badge (grey/amber/red with a leading dot) that cycles
  low → medium → high → low on click — directly from list rows, kanban cards,
  and the task dialog. The optional-details priority dropdown is gone; priority
  moved up beside Status and Assignee in the dialog. List and kanban now share
  a single `PriorityBadge` component instead of duplicating the variant map.

## 0.35.0 (2026-07-18)

- **Quick capture**: a global hotkey (default `Ctrl+Alt+N`, configurable in
  Settings) opens a small always-on-top window with the clipboard pre-pasted
  into the description — type a title, hit Ctrl+Enter, and an `inbox` task
  lands in the vault (with an OS notification). Slack links in the clipboard
  auto-tag the task `slack`. If the preferred hotkey is taken by another app,
  fallbacks are tried (`Ctrl+Shift+N`). The window remembers its position and
  size across opens and can be moved by dragging its header. Long clipboard
  content (>500 chars or >10 lines) is not auto-pasted — a "Paste clipboard"
  button inserts it on demand — and a clear button empties the description
  in one click.

## 0.34.0 (2026-07-17)

- Repos: projects on a WSL share (`\\wsl.localhost\<distro>\...`) now work.
  git commands run inside the distro via `wsl.exe`, fixing the
  "detected dubious ownership" error in the Changes panel (and avoiding the
  slow 9P share). "Open in VS Code" opens such projects with VS Code
  Remote-WSL (`code --remote wsl+<distro>`) instead of Windows VS Code on
  the UNC path.

## 0.33.0 (2026-07-17)

- Tasks: the task dialog can now jump to the task file in **Obsidian**
  (`obsidian://open`). Edit mode gained a header button that flushes pending
  edits and opens the file; create mode gained **Create & edit in Obsidian**,
  which creates the task and opens the new file for rich editing (images,
  full Markdown). Kanban cards and list rows also carry the jump button
  (gem icon), so Obsidian is one click away without opening the editor.
  External edits flow back via the existing vault watcher.

## 0.32.0 (2026-07-16)

- Tasks: the view gained a toggleable, resizable **embedded terminal panel**
  (xterm.js + ConPTY) running the herdr client, so agent progress can be
  watched in-app instead of switching to an external Windows Terminal window.
  New `terminal_embed` setting (Settings dialog, under "Open AI tasks in a
  fresh herdr workspace"): when enabled, launching an agent opens the panel
  and Rust polls briefly for the herdr server instead of spawning `wt`.

## 0.31.1 (2026-07-16)

- Repos: file names containing non-ASCII characters (e.g. Japanese) now
  display correctly in the changes/diff views. git was octal-escaping such
  paths (`\343\201\256`); all git calls now run with `core.quotepath=false`
  so paths are emitted as raw UTF-8.

## 0.31.0 (2026-07-16)

- Repos: git graph context menus reordered by frequency of use — checkout
  actions first, copy actions last, destructive actions at the bottom.
- Repos: any commit can now be checked out from its context menu
  (**Checkout this commit…**), detaching HEAD after a confirmation.
- Repos: the "uncommitted changes" row gained a **Discard changes** menu —
  discard tracked-file changes only, or also delete untracked files, each
  behind a confirmation dialog.

## 0.30.1 (2026-07-16)

- Tasks: long descriptions in the **Edit Task** dialog no longer overflow the
  Description preview box. The preview now stops at a fixed maximum height and
  scrolls internally, matching the user's request.

## 0.30.0 (2026-07-15)

- Tasks: the **Edit Task** dialog gained a **full-screen toggle** in the
  header — the dialog expands to nearly the whole window and the Description
  field absorbs the extra space, for writing long task specs comfortably.
- Tasks: wide content in the Description preview (e.g. fenced code blocks)
  no longer stretches past the dialog edge; code blocks scroll horizontally
  inside the dialog, and a long description scrolls the form instead of
  growing the dialog past the viewport.
- Tasks: markdown previews (Description and Results) now render single
  newlines as line breaks, matching how the same files read in Obsidian —
  previously consecutive lines collapsed into one paragraph.

## 0.29.0 (2026-07-15)

- New **screen annotation (ink) overlay**, ported from the Desktop Ink app:
  double-press Alt and hold the second press to draw temporary strokes on the
  monitor under the cursor; releasing Alt clears them and restores
  click-through. While drawing, **Alt+S** cycles the pen color
  (red → blue → green) and holding **Shift** snaps the stroke to a horizontal
  or vertical line. The feature (including its global key listener) can be
  toggled in Settings — **"Screen annotation"**, enabled by default.
- Ink: Alt detection uses the **Raw Input API** (`RIDEV_INPUTSINK`) instead of
  a `WH_KEYBOARD_LL` hook — low-level hook delivery silently stops when the
  app's own webview holds keyboard focus, which made the gesture dead while
  workhub itself was focused.
- Ink: the current pen color is now visible while drawing — a small
  pen-color chip follows the cursor at its lower right, updating instantly on
  Alt+S. (The chip is a DOM element rather than a tinted OS cursor: WebView2
  caches the visible cursor and ignores CSS cursor changes until a real
  pointer interaction, so a colored cursor could not be refreshed reliably.)

## 0.28.0 (2026-07-15)

- Tasks: the **Edit Task** dialog now closes automatically after launching an
  AI agent from it. Keeping the dialog open let a subsequent close trigger an
  auto-save that wrote the stale draft (including the old `status`) back to
  disk, overwriting the agent's own changes such as `todo` → `doing`.

## 0.27.0 (2026-07-14)

- Tasks: the opencode (and project) combobox dropdowns inside the task
  editor dialog now scroll with the mouse wheel again. They lived inside a
  modal Radix Dialog, and without the combobox's own `modal` popover layer
  the dialog's scroll-lock swallowed wheel events on the portaled dropdown —
  the catalog rendered but wouldn't scroll. Setting it makes the popover its
  own modal layer so wheel and click both work (same fix previously applied
  to the branch switcher in the Git Graph sheet).
- Tasks: when the opencode model dropdown shows a **Recent** group, the
  rest of the catalog now appears under a separate **All models** heading
  instead of continuing the Recent section without a label, so the two
  groups are visually distinguishable.

## 0.26.0 (2026-07-14)

- Tasks: the opencode model picker now shows a **spinner with "Loading…"**
  while the model catalog is still being fetched from the `opencode models`
  CLI, instead of presenting a blank dropdown until the spawn finishes.
- Tasks: opencode model picks are now remembered per app install and surfaced
  at the top of the dropdown in a **Recent** group, so frequently used models
  are one click away instead of re-typed each time. The list is capped at
  five entries (most-recent first) and stale entries are filtered out once the
  catalog is available.

## 0.25.0 (2026-07-14)

- Tasks: add **fable** to the Claude Code model dropdown in the task editor,
  alongside haiku / sonnet / opus.

## 0.24.0 (2026-07-14)

- Tasks (kanban): the column headers (Inbox / Todo / Doing / Review / Done) now
  stay pinned at the top while a column's cards scroll. Previously a tall column
  scrolled the whole board and pushed the status headers out of view; each
  column now scrolls independently with its header fixed.
- Tasks (kanban): add an **Archive** button to the Done column header that
  archives every task in the column in one action, so you no longer have to
  archive finished tasks one by one. It appears only when the column holds at
  least one non-archived task and asks for confirmation first.

## 0.23.0 (2026-07-14)

- Tasks: archiving a task now moves its file into a `tasks/archive/` subfolder
  (and unarchiving moves it back), so the flat `tasks/` listing stays
  uncluttered in Obsidian/Explorer as archived tasks accumulate. The
  `archived: true` frontmatter flag remains the source of truth; the folder is
  kept in sync with it. Archived tasks still reserve their id, stay in the
  index, and remain findable — existing vaults migrate their already-archived
  tasks automatically on load.

## 0.22.0 (2026-07-14)

- Tasks: add a **Copy prompt** button next to the **Launch agent** button on
  task list rows, kanban cards, and in the task edit dialog. It copies the
  exact agent prompt (task id, execution mode, worktree/confirm flags, project,
  and task file) to the clipboard in English so you can paste it into another
  AI terminal manually. The button shows a brief "Copied" check animation for
  feedback.
- Settings: add a manual **Check for updates** section so you can see the current
  version and download/install the latest release from the Settings dialog. After
  the update downloads, a **Restart now** button swaps to the new version without
  leaving the app.

## 0.21.0 (2026-07-14)

- Tasks: the **Launch agent** control is now a compact icon button (a robot)
  instead of a text button, with a tooltip for discoverability. On the list it
  sits at the row's end; on kanban cards it tucks into the meta line so the card
  no longer carries a full-width button. Clicking it plays a "launching"
  animation that holds for a couple of seconds and then flashes a success
  check — because spawning the terminal returns before its window is visible,
  this bridges the previously confusing gap where a click seemed to do nothing.
- Tasks: the edit dialog header gains a **Launch agent** icon button for
  `claude-code` / `opencode` tasks, so you can start an agent without leaving
  the editor. It flushes your pending edits to disk first, so the agent always
  reads the current task content.

## 0.20.0 (2026-07-13)

- Tasks: the task **Description** now renders as markdown when you're not
  editing it — URLs become clickable links that open in your browser, and
  formatting (lists, headings, code) is shown inline. Click the description to
  switch back to raw-markdown editing; blur to return to the preview. This is a
  lightweight step toward an Obsidian-style reading/editing experience.
- Tasks: a new **Results** button in the edit dialog header opens a slide-over
  sheet showing the task's `## Results` section as rendered markdown. Fenced
  code blocks get a hover **copy** button. The Results section is read-only —
  the app never rewrites it.
- Git Graph: the header gains a **branch switcher combobox** listing every
  local and remote branch, split into **Local / Remote** groups. Type to filter
  (handy when a repo has many branches) and select one to check it out — remote
  branches are checked out via git's DWIM, creating the local tracking branch as
  needed.
- Repos: the row menu's **Switch branch** submenu gains a filter box and
  **Local / Remote** groups, and can switch to remote branches too (not just
  local) — the remote is checked out via git's DWIM.

- Repos: new **Changes** panel (toolbar toggle) — a built-in, VS Code-style
  view of a repository's uncommitted work without leaving Workhub. Click a
  repo row to show its working-tree changes as a file list with a unified
  diff; the panel auto-refreshes every few seconds while the window is
  focused, so an agent's edits appear as they happen. Untracked (brand-new)
  files are now included alongside tracked modifications — the diff for a new
  file renders its full contents as additions. The list/diff split and the
  panel's own left/right split are resizable (shadcn `resizable`) and their
  sizes persist across restarts.
- Repos: the changed-file list (both the new Changes panel and the Git Graph
  diff panel) can now be shown as a **folder tree** (default) or a flat path
  list, toggled with an icon button. The tree compacts single-child folders
  (e.g. `src/components/repos`) and starts fully expanded; the view choice
  persists across the app.
- Repos: the project list now **auto-refreshes git status** every 5 seconds
  while the Repos tab is visible and the window is focused, so branch,
  ahead/behind, and uncommitted-change badges stay current as an agent works.
  It reads local status only (no network fetch), updates quietly without the
  per-row refresh spinner, and skips repos with an in-flight git operation.
- Git Graph: branch/remote ref right-click menus gain a **Copy branch name**
  item; hovering any ref badge (and the header's current-branch badge) now
  shows the full name in a tooltip when it's truncated; and the panel no
  longer closes on an outside click (which could fire unexpectedly while a
  commit context menu was open) — close it with the header's × button or
  Escape.

## 0.18.0 (2026-07-12)

- New **Timer** tab (right of Music): a countdown timer for focused work
  sessions. Pick 5 / 15 / 30 / 60 minutes or type any duration, then
  start / pause / resume / reset. The countdown keeps running while you work in
  other tabs.
- When it hits zero, the timer plays an alarm (beeps synthesized with the Web
  Audio API — no bundled audio file) and raises a desktop notification. Both
  are individually switchable and the volume is adjustable; the sound, volume,
  notification and last-used duration settings persist across restarts.
- Tasks: fixed the Create button flashing briefly when closing an Edit Task
  dialog. The rendered dialog mode is now held stable during the exit
  animation so the footer does not switch from Edit to Create while the dialog
  is still visible.

## 0.17.0 (2026-07-12)

- Repos: new **Worktrees** panel (toolbar button). Lists the git worktrees of
  your registered repos via `git worktree list`, grouped by task id, so you
  can see every task worktree at a glance without asking an agent. Each row
  opens in VS Code / Explorer / a terminal, or is removed in place
  (`git worktree remove`) with a confirmation dialog — force is required for a
  dirty worktree, and deleting the `task/<id>` branch is a separate opt-in with
  an unmerged-loss warning. A multi-repo task's worktrees open together as one
  VS Code workspace.
- Settings: new **Worktree root** setting (default `C:/repos/.worktrees`) — the
  directory task worktrees live under.
- Tasks: task worktrees are now laid out task-first as
  `<root>/<task-id>/<repo-name>` (previously `<root>/<repo-name>/<task-id>`),
  so a multi-repo task keeps all its worktrees under one `<task-id>/` folder.
  Applies to newly created worktrees; the Worktrees panel lists existing ones
  regardless of layout. (Requires the `workhub` plugin 0.8.0 for the matching
  `task-start` instruction.)

## 0.16.1 (2026-07-12)

- Repos: the checked-out branch is now obvious in the Git Graph. Its ref badge
  is filled instead of outlined (a detached `HEAD` badge likewise), the HEAD
  commit's row gets a tint and a left accent, and the HEAD dot's ring is drawn
  in the foreground color so it stays visible on every lane hue.

## 0.16.0 (2026-07-12)

- Tasks: every button now shows a pointer cursor on hover (previously the
  default arrow), so clickable controls read as clickable.
- Tasks: new per-task **Confirm mode** toggle in the task dialog. When on, an
  agent launched for the task drafts a plan and waits for your approval before
  executing instead of running autonomously — claude starts in plan permission
  mode and opencode drops `--auto`. This fixes task Descriptions that ask the
  agent to confirm being ignored because the launch prompt hard-coded "run
  without asking".
- Tasks: new per-task **Git worktree** toggle in the task dialog. When on, a
  launched agent works in a dedicated git worktree
  (`<repo>/../.worktrees/<repo>/<task-id>` on branch `task/<task-id>`) so
  parallel tasks on the same repository don't collide. Off by default. The
  `task-start`/`task-report` skills create and (on request) clean up the
  worktree.

## 0.15.0 (2026-07-12)

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

## 0.14.0 (2026-07-12)

- Music: playlist tabs can now be reordered by dragging them.
- Music: right-clicking a song in the playlist opens a context menu with
  "Move to playlist" (moves the song to another playlist) and "Remove from
  playlist". A move is refused if the song already exists in the target
  playlist.

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
