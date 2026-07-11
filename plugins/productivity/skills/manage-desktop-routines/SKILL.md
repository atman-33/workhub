---
name: manage-desktop-routines
description: Create, back up, and restore Claude Code Desktop local routines (scheduled tasks) so they survive a PC change. Use when the user wants to set up a recurring or one-off Desktop routine, back up their routines, or restore routines on a new machine.
disable-model-invocation: true
argument-hint: create <what to automate> | backup | restore
compatibility: Requires Claude Code Desktop's scheduled-tasks MCP tools (create_scheduled_task, list_scheduled_tasks, update_scheduled_task).
---

Manage Claude Code Desktop routines: create a **local** routine, and keep a portable backup so it isn't lost when you move to a new machine.

## Local vs remote

Desktop's Routines page creates two different things:

- **Local** — a scheduled task stored at `~/.claude/scheduled-tasks/<taskId>/SKILL.md` (or under `CLAUDE_CONFIG_DIR`) on this machine only. It runs only while Desktop is open. Nothing about it is synced to the cloud, so it is lost on a fresh machine unless backed up. This skill manages **local** routines only.
- **Remote** — a saved configuration in the user's claude.ai account, run on Anthropic-managed cloud infrastructure. It already survives a machine change on its own and needs no backup. If the task needs to run with the machine off, or fire on an API call or GitHub event, tell the user to create a **Remote** routine instead, from Desktop's **Routines → New routine → Remote** or [claude.ai/code/routines](https://claude.ai/code/routines) — this skill does not create those.

Ask the user which they need only if it isn't obvious from the request; local file/tool access implies Local, "even when my laptop is off" or API/GitHub triggers imply Remote.

## Backup scope

`list_scheduled_tasks` and `create_scheduled_task` expose `taskId`, `description`, `prompt`, `cronExpression`/`fireAt`, and `enabled`. They do **not** expose the working folder or model shown in Desktop's own routine form — those live outside this tool surface. A backup/restore cycle through this skill preserves the schedule and prompt exactly, but after a restore the user must reopen each routine in Desktop and re-pick its folder and model, and re-approve any "always allow" tool permissions (these reset to Ask mode by default).

## Backup directory config

The backup location is stored in `config.json`, next to this file (same folder as `SKILL.md`). It is generated from the checked-in `config.example.json` template and is itself git-ignored, so each installer of this skill can point it at their own directory without touching the shared marketplace repo.

Before any Backup or Restore step: read `config.json` in this skill's own folder.

- If it exists, parse `{ "backupDir": "<absolute path>" }` and use that path.
- If it doesn't exist, read `config.example.json` in the same folder for the expected shape, ask the user for an absolute backup directory (a synced folder like an Obsidian vault, Google Drive, or a git repo works well since it survives a machine change on its own), create that directory if missing, then write `config.json` with the placeholder replaced by the real path.

## Referencing other skills from a routine prompt

A routine fires with no interactive user, so a skill whose frontmatter has
`disable-model-invocation: true` can't be reached by name or `/slash` syntax —
that flag exists specifically to require a human typing the command. Before
writing "use the X skill" into a prompt:

1. Find X's `SKILL.md` and check its frontmatter for `disable-model-invocation`.
2. If set, resolve X's current absolute path — project scope
   (`.claude/skills/<name>/SKILL.md`), user scope (`~/.claude/skills/<name>/SKILL.md`),
   then the plugin cache (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md`;
   cross-check the installed version via `~/.claude/plugins/installed_plugins.json`).
3. Write the prompt as "Read `<absolute path>` and follow its instructions" —
   never the bare skill name. Plugin-cache paths are version-pinned and move on
   update, so add one fallback line: "if that path is missing, glob
   `~/.claude/plugins/cache/*/<plugin>/*/skills/<name>/SKILL.md` and use the
   highest version found."
4. If X's own SKILL.md already fixes an output format (a report layout, a
   message template), point at the file rather than restating it — only
   inline a format spec in the routine prompt when no downstream skill
   already owns it.

## Branch: create

1. **Decide local vs remote** per the section above. If the user wants remote, explain this skill doesn't create those and stop here.
   - Completion criterion: local vs remote is explicit before continuing.
2. **Collect the four fields**: a unique kebab-case `taskId`, a one-line `description`, the full `prompt`, and a `schedule` — a cron expression (local time), a one-off ISO 8601 `fireAt`, or neither for a manual-only task. The prompt runs headless with no memory of this conversation, so write it fully self-contained: what to do, any connectors to use, and what the output should look like. Resolve any referenced skill per "Referencing other skills from a routine prompt" above. Don't tell the agent to "match the style of `<a past message/URL>`" — that forces a live fetch every run just to rediscover a format that could be fixed once at authoring time; write the exact output structure inline instead, unless a downstream skill's own SKILL.md already fixes that format. A routine's prompt is re-parsed on every run, so treat every extra sentence as a recurring token cost: prefer literal values (IDs, channel names, resolved absolute paths) over descriptions the agent must re-resolve, and keep wording short and unambiguous.
   - Completion criterion: all four fields are set, the prompt contains no references to "this conversation" or unstated context, and no `disable-model-invocation` skill is referenced by bare name without a resolved absolute path.
3. **Call `create_scheduled_task`** with those fields.
   - Completion criterion: the call succeeds.
4. **Hand the user a concrete post-creation checklist** — this skill's tools can only set `taskId`, `description`, `prompt`, and the schedule; they cannot set the working folder, execution model, or permission mode (auto-accept edits / bypass permissions / ask each time), which all follow Desktop's current defaults until changed. Tell the user to open the task in Desktop's Routines list and: (a) set the folder and model if the defaults aren't right, (b) pick a permission mode that won't block on approval prompts if this routine should run unattended, and (c) click "Run now" once to confirm it completes end-to-end and pre-approve any tool/connector permissions for future runs — this authoring conversation can invoke any skill directly, but the actual headless run is a different execution context (e.g. an unreachable `disable-model-invocation` skill fails only there).
5. **Run the Backup branch now** (below) so the new task is captured immediately, not just at the next manual backup.
   - Completion criterion: the backup file reflects this task before finishing.

## Branch: backup

1. Resolve the backup directory (see Backup directory config).
2. Call `list_scheduled_tasks`.
3. For each task returned, `Read` its `path` to get the current prompt text (the list call itself only returns metadata).
4. Write `<backupDir>/desktop-routines-backup.json`: a JSON array, one object per task, with `taskId`, `description`, `prompt`, `cronExpression`, `fireAt`, `enabled`, and a `backedUpAt` ISO timestamp. Overwrite the whole file so deleted tasks don't linger in the backup.
   - Completion criterion: every task from step 2 has exactly one entry in the written file — none skipped.
5. Report the count of tasks backed up and the file path.

## Branch: restore

1. Resolve the backup directory and read `<backupDir>/desktop-routines-backup.json`. If it's missing, tell the user to run the Backup branch on the source machine first, and stop.
2. Call `list_scheduled_tasks` on this machine to see what already exists.
3. For each entry in the backup file whose `taskId` is not already present, call `create_scheduled_task` with its `taskId`, `description`, `prompt`, and `cronExpression`/`fireAt`. For entries whose `taskId` already exists locally, skip them — don't overwrite a task that may have since diverged.
   - Completion criterion: every backup entry is accounted for as created or explicitly skipped, none silently dropped.
4. Report a table of `taskId | created/skipped | note`, then remind the user (per Backup scope above) to revisit each newly created task in Desktop to set its folder, model, and tool permissions.

## Failure modes

- `scheduled-tasks` MCP tools aren't available: this skill requires Claude Code Desktop's Routines feature — say so and stop rather than guessing at file paths.
- Backup directory doesn't exist or can't be created: ask the user for a different path rather than failing silently.
- User's request is actually for a **remote** routine: point them to Desktop's Routines → New routine → Remote, or [claude.ai/code/routines](https://claude.ai/code/routines); don't attempt to create it here.
- **Referenced skill can't run headless**: a `disable-model-invocation: true` skill named by its bare name (not resolved to an absolute path) silently fails to invoke on a scheduled run — always resolve per "Referencing other skills from a routine prompt" above.
