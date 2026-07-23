# Changelog

## 0.59.0 (2026-07-24)

- **New Schedule tab for planning project dates** (T-0088..T-0092). A
  workspace for *deciding* dates rather than recording them: weeks run
  continuously down the page instead of being cut into months, so a plan
  spanning two months stays readable in one piece. Drag elements to move them,
  drag an edge to stretch them, sweep an empty range to see its calendar and
  working day counts, and right-click a day to mark it non-working. Every bar
  reports the working days it actually covers.
  - Schedules are plain Markdown at
    `projects/<project-slug>/schedules/<name>.md`, editable in Obsidian at the
    same time. External edits appear in the app immediately; a save that would
    overwrite someone else's change is refused and the note reloads instead.
  - Tasks with a `due` date in the same project show as chips on the calendar,
    and dragging one updates the real task. Elements can link to a task with
    `task:<id>` and show its status.
  - **HTML output** writes a single self-contained file (default: the
    project's `attachments/`) that opens anywhere and prints to A4 landscape
    for PDF hand-off.
  - **AI editing**: describe a change in plain language and a headless agent
    applies it through the new `schedule-edit` skill, rewriting only the
    affected lines. The calendar locks while it runs, and one press restores
    the note to how it was just before.
  - New settings under **Vault → Schedule**: agent, model, confirm-first mode,
    and a default export folder.
  - The project picker lists every folder under the vault's `projects/`, so a
    project with no schedule yet can still have its first one created.

## 0.58.1 (2026-07-23)

- **Long-term memory setup no longer needs a C/C++ toolchain** (T-0086): the
  memory engine now uses the WebAssembly SQLite build instead of a native
  binding, so `/memory-setup` never falls back to compiling from source and
  never asks for the Visual Studio C++ desktop workload. The Help section for
  long-term memory states this explicitly. Databases created by the previous
  engine are converted out of WAL mode automatically on first use.

## 0.58.0 (2026-07-23)

- **Automatic vault tidy writes its review task in the configured task
  language** (T-0085): the unattended tidy prompt now carries the **Task file
  language** setting, so the title and `## Description` of the `#tidy-review`
  task it creates or updates are written in that language instead of always in
  English. The scope stops there — frontmatter values, folder and file naming
  conventions, `_ai/memory/tidy-pending.json`, and the `_ai/logs/kb-log.md`
  entries stay in English.

## 0.57.0 (2026-07-23)

- **Vault template conflicts can be resolved by replacing the file** (T-0084):
  a **conflict** in the template update dialog is no longer forced through a
  `<name>.new` side file. Each conflicting file now offers two resolutions —
  **Keep mine (write .new)** (the default, unchanged behavior) or **Replace
  with template**, which overwrites the vault's copy in place and advances the
  recorded baseline so the file stops reporting a conflict on every later
  check.
- **Diff preview in the template update dialog**: **Show diff** on any pending
  file renders the unified diff between the vault's current copy and the
  incoming template content, so an overwrite is an informed choice rather than
  a blind one.

## 0.56.2 (2026-07-23)

- **Fix:** the project folder scaffold added in 0.56.1 introduced note types
  (`project-readme`, `prd`, `roadmap`, `spec`, `backlog`, `index`) not covered
  by the `type` enum documented in `vault-template/.claude/rules/notes.md`;
  extended the enum to match. Run `vault-init`/vault template sync to pick it
  up in existing vaults. No app behavior change.

## 0.56.1 (2026-07-23)

- **Standard project folder scaffold in the vault template**: `vault-template/`
  now ships `templates/project/` (README entry point, `prd.md`, `roadmap.md`,
  `specs/`, `backlog/` with an Obsidian Base view, `research/`, `dev-notes/`,
  `deliverables/`, `attachments/`, `_index.md`) plus documentation of the
  layout and the backlog-vs-tasks flow in `CLAUDE.md` and a new
  `.claude/rules/projects.md`. Run `vault-init`/vault template sync to pick it
  up in existing vaults. No app behavior change.

## 0.56.0 (2026-07-21)

- **Vault tidy runs are always resumable** (T-0082): the agent session id is
  now assigned before the run starts instead of being read out of the finished
  run's output, so a run that is killed, stalls, or is cut short by quitting
  the app can still be picked up. The id is persisted with the run record
  (surviving an app restart), shown next to the run status with a copy button,
  and written into the run log under `_ai/logs/tidy/` together with a
  ready-to-paste `claude --resume` command. **Resume session** is available
  whenever an id is known, not only after a failure.
- **Changed:** vault tidy now runs with the same auto-approve permission mode
  as a task-card agent launch (`--permission-mode auto` for Claude Code,
  `--auto` for OpenCode) instead of bypassing permission checks entirely. An
  unattended run no longer has more authority over the vault than an
  interactive one; anything it is not allowed to do is skipped, and the run can
  be finished by hand via Resume session. OpenCode tidy runs previously had no
  auto-approve flag at all and could sit waiting for a confirmation.

## 0.55.0 (2026-07-21)

- **Help screen navigation** (T-0080): the Help tab now opens with every
  section collapsed, so the headers act as a table of contents. A contents row
  of section chips sits under the title — clicking one opens that section and
  scrolls to it — and an **Expand all** / **Collapse all** button next to
  **Copy all** toggles the whole guide at once. The guide's wording is
  unchanged.
- **Fixed:** copying a task's prompt from the task editor now closes the editor
  (T-0081). The dialog saves the draft when it is dismissed, so leaving it open
  while an agent worked the copied prompt could overwrite the status the agent
  had set. **Copy prompt** now flushes the pending autosave, copies, and closes
  without the save-on-close — the same handling **Launch agent** already had.

## 0.54.1 (2026-07-20)

- **Fixed:** the window no longer shows a blank white page while the frontend
  loads (T-0079). `index.html` now carries an inline dark background and a
  small loading spinner that need no external CSS or JS, so they apply on the
  first paint; `main.tsx` fades them out once React has mounted. The spinner
  is held back for 200 ms, so a fast start shows no spinner at all. Most
  visible under `npm run tauri:dev`, where Vite serves modules unbundled and
  the gap before React mounts is several seconds.
- **Fixed:** the Settings dialog's scroll area now ends with bottom padding, so
  the last section of a long tab (Commands, Vault) is no longer flush against
  the bottom edge when scrolled all the way down.

## 0.54.0 (2026-07-20)

- **Custom prompt** (T-0078): **Settings → Commands** gains a free-form field
  whose text is appended to the end of every agent prompt — both when
  launching an agent and when using **Copy prompt**. Use it for standing
  instructions that apply to all tasks (e.g. "Respond to me in Japanese");
  task-specific instructions still belong in the task's Description. Line
  breaks are collapsed into spaces so the prompt survives being quoted into a
  one-line command. Empty by default, so existing setups are unchanged.
- **Settings → General** is now grouped consistently: *Startup checks* (app
  updates, vault template updates, long-term memory setup notice),
  *Long-term memory* (per-agent toggles), and *Features* (screen annotation,
  quick capture). Previously only the memory box was framed while the other
  checkboxes sat loose around it.

## 0.53.2 (2026-07-20)

- New application icon (T-0076). The window, taskbar and executable icons now
  use the ice-crystal artwork in place of the previous purple "W" mark. The
  full `src-tauri/icons/` set (Windows, Store, iOS, Android) was regenerated
  from the new source with `tauri icon`.

## 0.53.1 (2026-07-20)

- **Fixed:** `inject-target-rules-plugin` and `inject-extended-rules-plugin`
  in the OpenCode vault template now inject a touched target repo's
  `CLAUDE.md` / `.claude/rules` guidance in the SAME turn a file is read or
  edited, instead of one user turn late (T-0073). The rule text is appended
  to the tool result (`tool.execute.after`) rather than queued for the next
  system-prompt assembly.

## 0.52.3 (2026-07-20)

- OpenCode plugin logs are now written to `vault-template/.opencode/plugins/logs/`
  and ignored by `.gitignore`, so new log files no longer appear as untracked
  changes (T-0069).

## 0.52.2 (2026-07-20)

- Grouped the long-term memory settings (setup notification, per-agent
  Claude Code / OpenCode toggles) into a single labeled box in **Settings →
  General**, matching the existing "App update" section — they had been
  three loose checkboxes crowding the tab since 0.52.0.

## 0.52.1 (2026-07-20)

- **Fixed:** Repositories removed via "Remove from Workhub" no longer
  reappear after restarting the app (T-0068). The frontend was issuing two
  overlapping saves, and the second one used stale config state that wrote
  the pre-removal project list back to disk.

## 0.52.0 (2026-07-20)

- **Long-term memory for AI agents (T-0060).** The workhub plugin now ships a
  local memory engine: every agent session's Q&A pairs are saved into
  `<vault>/_ai/memory/memory.db` (Stop hook), and new sessions receive a time
  summary plus past conversations relevant to the current prompt via hybrid
  FTS5 + vector search (UserPromptSubmit hook). Fully local — SQLite +
  sqlite-vec + an ONNX embedding model (Ruri v3), no cloud, no LLM. Setup is
  the one-time `/memory-setup` skill; `/memory-recall` searches on demand.
- OpenCode sessions get the same memory via the vault's
  `.opencode/plugins/memory-plugin.ts` (context injection on each message,
  capture on session idle), backed by the identical engine and database.
- The app now checks on startup whether the memory engine is set up on this
  machine and shows a banner pointing at `/memory-setup` when it is not.
  Disable the notice in **Settings → General** (`check_memory_setup`), and
  toggle the feature per agent with the new **Long-term memory in Claude
  Code / OpenCode sessions** settings (`memory_claude_code`,
  `memory_opencode`).
- New Help section: **Long-term memory for AI agents**.

## 0.51.0 (2026-07-19)

- **Voice input transcription is much faster.**
  - whisper.cpp now builds with the Vulkan GPU backend: transcription runs
    on the GPU when one is available (NVIDIA/AMD/Intel) and falls back to
    CPU automatically otherwise. Building from source now requires the
    Vulkan SDK (`VULKAN_SDK` env var).
  - CPU decoding uses up to 8 threads instead of whisper.cpp's default cap
    of 4.
  - Two quantized models were added to the catalog: `small-q5_1` (~182 MB,
    near-`small` accuracy at a fraction of the size and decode time) and
    `large-v3-turbo-q5_0` (~547 MB, the most accurate option and fast on a
    GPU).
  - The model is preloaded in the background as soon as recording starts,
    so the first transcribed chunk no longer waits behind a multi-second
    model load.
  - Sub-second audio chunks are padded with silence before decoding, which
    whisper otherwise handles poorly.

## 0.50.0 (2026-07-19)

- **Fixed a vault template sync bug that could silently overwrite
  user-edited files with the template's empty placeholders — including
  `.claude/project-context.json` (a user's registered repositories),
  `projects/_index.md`, and `archive/_index.md`.** The 3-way compare that
  decides whether a template update is safe to auto-apply relies on a
  "baseline" recorded in `_ai/template-manifest.json`: the content that was
  last known to match the template. Initializing a vault used to record
  *whatever was already on disk* as that baseline for a pre-existing file —
  even if the user had customized it. On the next check, the user's own
  content then looked identical to the baseline, so a later upstream
  template change was misclassified as a clean, safe overwrite (`Updatable`)
  instead of a `Conflict`, and the customized file was silently replaced.
  This affected any hand-edited file that wasn't already excluded from
  tracking, not just `project-context.json`.
  - `init_from` no longer records a baseline for a pre-existing file unless
    its on-disk content is confirmed to already match the template; a
    diverging file now correctly falls through to a `Conflict` report
    instead.
  - The list of files that are seeded once and never diffed/overwritten
    again (previously a hardcoded `INITIAL_ONLY_PATHS` list covering only
    `home.md`, `tasks/_index.md`, `knowledge/_index.md`) is now a
    data-driven `.template-policy.json` at the template root, and now also
    covers `.claude/project-context.json`, `.claude/settings.json`,
    `projects/_index.md`, and `archive/_index.md` — the files most likely to
    diverge per-vault. If that policy file is ever missing or unparseable,
    every template file is treated as seed-only (the safe direction — never
    overwrite) and the app logs why.
  - Manifests written by 0.49.0 or earlier cannot be trusted (they may carry
    exactly the baseline bug described above), so they are now detected via
    a new `schema_version` field and have their recorded baselines discarded
    on load. Any file that has actually diverged from the template will
    report `Conflict` on the next check instead of silently reapplying the
    old, unsafe classification; a single review clears it back to normal.
  - If you were affected before this fix, your vault's lost content is not
    recovered automatically — restore it by hand (e.g. from git history or a
    backup) if needed.

## 0.49.0 (2026-07-19)

- **Fixed Settings silently failing to save, sometimes permanently.** Two
  independent bugs compounded on at least one machine: the "Check for vault
  template updates on startup" setting added in 0.47.0 existed only in the
  frontend's type definitions, not in the Rust struct that actually gets
  saved — serde quietly drops unknown fields, so the checkbox always reverted
  after a restart. Separately, every write to `config.json` swallowed its own
  errors, so when something on disk blocked the write (folder-shielding
  antivirus software is the leading suspect), the Settings dialog still
  reported success and nothing ever reached disk — for over a week, in the
  case that surfaced this.
  - The Rust and TypeScript `Settings` types are now compared by an
    automated test on every build, so a field added to one side and
    forgotten on the other fails the build instead of failing silently at
    runtime.
  - A failed save is no longer silently discarded: it now surfaces as an
    error in the Settings dialog, and the dialog stays open (instead of
    closing on a save that didn't actually happen) so you can retry.
  - Settings, voice history, and downloaded voice models now live under
    `~/.workhub/` instead of `%APPDATA%\workhub\`, matching where task
    worktree workspaces were already stored for the same reason — the old
    `AppData\Roaming` location has been observed to silently reject writes
    under some antivirus configurations, while a plain dot-folder under the
    user's home directory does not. Existing installs are migrated
    automatically on first launch; the old location is left in place, never
    deleted.

## 0.48.0 (2026-07-19)

- **Fixed self-update failing permanently once a stale instance locked the
  update's "previous version" file.** Closing the main window used to leave
  workhub running in the background (the hidden quick-capture and voice
  windows kept it alive), so instances quietly accumulated across restarts.
  When an update later renamed one of those still-running exes aside, the
  file stayed locked forever — and because the app silently ignored the
  failure to remove a leftover from an even earlier update, every subsequent
  update attempt failed with "cannot move current exe aside: os error 5"
  until someone found and killed the stray processes by hand.
  - Closing the main window now quits the app immediately (there is no tray
    icon to keep it reachable otherwise); the hidden quick-capture/voice
    windows no longer keep it alive after that. As a side effect, their
    global hotkeys stop working once the app is closed — noted in the Help
    tab.
  - A second launch now focuses the existing window and exits instead of
    starting a duplicate instance (`tauri-plugin-single-instance`).
  - If the update's aside file is still locked by an old instance, it now
    falls back to a unique name (`workhub.exe.old-<timestamp>`) instead of
    failing outright, and the app sweeps up every leftover `.old`/`.new` file
    it can reach on startup. Failures now name the exact file involved and,
    for a lock-related error, suggest closing other running copies.

## 0.47.0 (2026-07-19)

- **The vault template now stays in sync with the app.** `vault-template/` is
  embedded in the binary at build time, so an installed copy no longer needs a
  checkout of this repo to initialize or update a vault — the template version
  is simply the app version.
  - On startup the app compares the vault against the embedded template and
    shows a banner when files are out of date. "Review" opens a per-file list;
    you choose what to apply.
  - Drift is tracked in `_ai/template-manifest.json` (a SHA-256 per file), which
    makes the comparison three-way: files you never touched update cleanly,
    files you edited are reported as conflicts and are never overwritten — the
    new version is written beside them as `<name>.new` instead.
  - New setting "Check for vault template updates on startup" (on by default).
  - This replaces the old HTML-comment marker scheme, which could not update a
    file once its marker version advanced, could not cover JSON files, and did
    not work outside a dev checkout. The marker lines are gone from the
    template. Existing vaults have no manifest yet, so any file whose content
    already differs from the template is reported as a conflict on the first
    check — review those once and the baseline is recorded from then on.

## 0.46.0 (2026-07-19)

- **Vault tidy deferred items now become a review task** instead of dying in
  the log. When an unattended run can't file an inbox note safely (a new
  folder, a rename, or unclear classification would be needed), the kb-ingest
  skill records it in `_ai/memory/tidy-pending.json` and creates-or-updates a
  single `#tidy-review` task on the board carrying a proposed plan per file —
  the human edits the proposals, then assigns the task to an agent to execute
  them.
  - The tidy pre-check in the app now reads `tidy-pending.json` and stops
    counting deferred files as "work", so a note waiting on human review no
    longer relaunches the agent every interval (it becomes eligible again as
    soon as the user edits it).
  - The Help tab's Vault tidy section documents the new review flow.
- workhub plugin 0.12.0: kb-ingest unattended review-task flow +
  `kb-log.md` yearly rotation; kb-index now groups `tasks/archive/_index.md`
  by year and treats it as the AI digest of archived tasks (bounded reads,
  one line + optional deliverable link per task).

- **Task files gained a `## Plan` section**, sitting between `Description`
  and `Results`. When a task uses confirm mode, the agent now writes the
  approved plan into this section before touching any code — so if the
  session later crashes, hits a usage limit, or gets closed, the plan the
  human already reviewed isn't lost. It also means a task can be picked up
  later, potentially by a different agent CLI (Claude Code → OpenCode), and
  the new agent follows the recorded plan instead of re-planning from
  scratch.
  - The section is read-only in the app — a **Plan** button appears next to
    **Results** in the task dialog header whenever a plan is recorded,
    opening the same kind of rendered-Markdown slide-over (mermaid diagrams
    and tables included). Editing a plan is an approval action, so the right
    place for it is Obsidian, where the human is already reviewing.
    Task cards on the board and in the list view show a small icon when a
    plan is present.
  - Existing task files are unaffected: a missing `## Plan` parses as empty,
    and the app never inserts the header on save — only newly created tasks
    (and the vault template) get an empty one.
- **New setting: task file language** (Settings → Commands → *Task file
  language*, English or 日本語). Controls only the language an AI agent
  writes a task's `## Plan` and `## Results` sections in — it never touches
  code, comments, commit messages, or other repository documentation.

## 0.44.0 (2026-07-19)

- **Music playlists can be moved between workhub installs.** The playlist tab
  bar gained an export and an import button, so a library built up on one
  machine can be reproduced on another instead of re-pasting every URL.
  - **Export** writes a JSON file — either the whole library or just the
    active playlist — through a save dialog. The same selection can also be
    copied to the clipboard as JSON, which is the quicker route when the
    playlist is going to someone over chat.
  - **Import** reads such a file, or JSON pasted on the clipboard, and
    **always appends**: existing playlists are never overwritten or edited.
    Playlist ids are regenerated so an import cannot collide with what is
    already there, and duplicate names get a `(2)` suffix. Anything past the
    10-playlist limit is reported as skipped rather than evicting a playlist.
  - Playback state (active tab, loop, shuffle) is deliberately left out of the
    export — it describes the machine, not the library. Importing also does
    not interrupt the song currently playing.

## 0.43.0 (2026-07-19)

- **Settings → Vault tidy** now reads in English regardless of the OS
  language, and picking a model no longer means typing one from memory.
  - **First run at** replaces the native `datetime-local` field with the
    app's own picker. The native popup — its calendar *and* its Clear/Today
    buttons — renders in the Windows display language no matter what the page
    declares, so a Japanese machine showed a Japanese control in an otherwise
    English UI. The new picker hard-codes English and matches the date picker
    already used for a task's due date.
  - **Model** is now a dropdown instead of a free-text box, offering the same
    catalog as a task's model field: Claude Code's aliases, or opencode's
    model list with recently-used entries pinned to the top. Typing a model
    that isn't listed still works, so models already saved in `config.json`
    keep working.
  - The **Next check** timestamp is formatted in English too.

## 0.42.0 (2026-07-19)

- **Quick capture no longer pastes arbitrary clipboard text.** The window was
  built for links you want to come back to (a Slack message about to get
  buried), but it pasted whatever happened to be on the clipboard, so
  unrelated content usually had to be deleted by hand. Now the clipboard is
  auto-pasted **only when it is a recognized link**, and anything else is
  offered on the existing **Paste clipboard** button instead.
  - Recognized sources: **Slack** messages/threads, **GitHub pull requests**,
    and **monday.com** items. Each tags the task (`slack`, `github-pr`,
    `monday`) and shows a badge in the capture window header; a link that
    matches several shows several.
  - Adding a source later is a one-line change in `src/lib/capture-patterns.ts`
    — the same list drives auto-paste, the badges, and the tags.

## 0.41.0 (2026-07-19)

- **Repos → commit graph**: the commit diff panel is now **resizable** — drag
  the divider between the commit list and the diff to give either side more
  room. The split is remembered across restarts.
- **Maximize the graph**: a new button in the graph header expands the sheet
  to the full window width (and back). The preference is remembered, and
  toggling keeps the loaded commits, the selected commit and the scroll
  position intact.

## 0.40.0 (2026-07-19)

- **Vault tidy**: a built-in routine that keeps the vault easy for AI to
  search by filing stale `inbox/` notes into the knowledge base and refreshing
  the `tasks/archive/_index.md` summary — launched as a headless agent (no
  terminal window). Configure it in the new **Settings → Vault → Vault tidy**
  section (off by default) and documented in the Help tab.
  - **Zero-token scheduling**: whether there is any work is decided by a cheap
    mechanical scan in the app (stale inbox files, or archive-index drift) — an
    agent is launched only when there actually is something to do. Scheduling
    is anchor + interval ("first run at" + "run every N hours", 24 = daily),
    so a run missed while the app was closed is caught up on the next launch
    rather than lost.
  - **Agent / model selectable**, just like a task (Claude Code or OpenCode).
    A configurable inbox age threshold and a set of excluded inbox subfolders
    (default `_wip`) let work-in-progress notes stay untouched.
  - **Manual "Run now"** works even when the schedule is off. Runs are tracked:
    a completion, failure, or stall raises a desktop notification, and a
    **Resume session** button reopens a failed/stalled headless run in a
    terminal (via `claude --resume`) so it can be finished interactively.

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
  - **Stop button**: the indicator now shows a small stop button while
    recording (pill and preview layouts), so a recording can be ended with a
    click instead of only the hotkey.
  - **Voice history tab**: every completed transcript is now saved to a new
    **Voice** tab (latest 50, oldest dropped first), regardless of whether
    the auto-paste into the focused app succeeded — a safety net for when the
    paste target lost focus. Each entry shows its timestamp and model, with
    copy and delete actions, plus a "Clear all" action.

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
