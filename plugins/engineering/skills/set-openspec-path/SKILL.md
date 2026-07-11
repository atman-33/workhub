---
name: set-openspec-path
description: Switch the openspecPath in .claude/project-context.json by picking one of the registered projects from a menu, instead of hand-editing the absolute path.
disable-model-invocation: true
allowed-tools: Read Write
---

Update `openspecPath` in `.claude/project-context.json` so the SessionStart hook
injects the chosen project's `openspec` docs folder. This replaces hand-editing
the absolute path with a menu choice.

Steps:

1. Read `.claude/project-context.json` from the current project root.
   - If the file does not exist, tell the user to run `setup-project-context`
     first and stop.
   - If it cannot be parsed as JSON, show the parse error and stop.

2. Collect the `projects` array (entries with a non-empty `path`). Present the
   choices to the user with `AskUserQuestion`:
   - One option per registered project, labelled by `name` (falling back to
     `path`), with the resulting `<path>/openspec` shown in the description.
   - Plus a **"Clear (use working-dir openspec)"** option that sets
     `openspecPath` to `""` — the hook then falls back to
     `<project-root>/openspec` automatically.
   - If `projects` is empty, tell the user there are no registered projects to
     pick from and stop.

3. Write the result back into `.claude/project-context.json`:
   - For a project choice, set `openspecPath` to `<chosen project path>/openspec`
     (forward slashes, no trailing slash).
   - For "Clear", set `openspecPath` to `""`.
   - Preserve every other field (`roleBasedDelegation`, `projects`, ordering,
     formatting) unchanged — only the `openspecPath` value is modified.

4. Report the new `openspecPath` value and remind the user:
   - The change takes effect on the **next session start** — `/reload-plugins`
     does not re-run SessionStart, so start a new session or `/clear`.
   - If the chosen project has no `openspec` folder, the hook automatically falls
     back to the working-directory `openspec` at injection time.
