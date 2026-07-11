---
name: setup-project-context
description: Scaffold or show the .claude/project-context.json file that the engineering hooks read to inject project context, target-repo guidance, and optional post-edit format commands.
disable-model-invocation: true
allowed-tools: Read Write
---

Set up the per-project configuration consumed by the engineering plugin's
hooks. `SessionStart` reads `.claude/project-context.json` from the project root
and injects a `<project-context>` block (registered project absolute paths +
openspec docs folder) into Claude's context at session start.

Steps:

1. Check whether `.claude/project-context.json` already exists in the current
   project (read it).
   - If it exists, show its current contents and stop. Tell the user to edit it
     by hand, and that changes take effect on the next session start.

2. If it does not exist, create `.claude/project-context.json` with this
   template (replace the placeholder paths with the user's real absolute paths):

   ```json
   {
     "roleBasedDelegation": true,
     "openspecPath": "<absolute path to the openspec docs folder>",
      "postToolFormatCommands": [
        "<optional global default command run in any target project root after Edit/Write>"
      ],
     "projects": [
       {
         "name": "example-project",
         "path": "<absolute path to a frequently-used project>",
          "summary": "short one-line description (optional)",
          "postToolFormatCommands": [
            "<project-specific command run in this project's root after Edit/Write>"
          ]
       }
     ]
   }
   ```

3. Report what was done and remind the user:
   - `roleBasedDelegation`, `openspecPath`, `postToolFormatCommands`, and
     `projects` are all optional; omit any of them and the relevant hook skips
     that part. A missing file injects nothing.
   - A sibling repo's own guidance is injected lazily by the plugin's PreToolUse
     hook (`inject-target-rules.mjs`): when you Read/Edit/Write a file under a
     registered project, it injects that repo's root instruction file
     (`CLAUDE.md`, or `AGENTS.md` if there is no `CLAUDE.md`) in full once per
     session, plus any `.claude/rules/*.md` whose `paths:` front matter matches
     the touched file. Nothing is injected for files under the current working
     directory (that guidance loads natively).
   - `postToolFormatCommands` may be set globally or inside a specific
     `projects[]` entry. Project-specific commands override the global default.
     The hook runs each listed shell command sequentially after Claude
     `Edit`/`Write` operations for files under registered target projects
     outside the current working directory. Each command runs in the matched
     target project's root, and failures are reported in a `systemMessage`
     without blocking the main flow.
   - `openspecPath` may be left empty (or pointed at a missing folder); the hook
     then auto-resolves it to the working-directory `openspec`
     (`<project-root>/openspec`). Use the **set-openspec-path** skill to switch
     it later by picking a registered project from a menu.
   - Set `roleBasedDelegation` to `true` to inject the engineering plugin's
     role-based delegation criteria (when/whom to delegate to the `code-explore`,
     `implementer`, `heavy-implementer`, and `test-runner` sub-agents) at session
     start. Leave it out to keep sessions lean.
   - Use absolute paths for the current environment. Windows and WSL use
     different path forms (`C:/repos/...` vs `/mnt/c/repos/...`), so if you run
     Claude Code in both on the same repo, the values must match the environment
     you launch from.
   - The new context is injected on the next session start (`/reload-plugins`
     does not re-run SessionStart; start a new session or `/clear`).

## Output Format

- If `.claude/project-context.json` already exists, show its path and contents in
  a fenced `json` block, then state that the user should edit it by hand and that
  changes take effect on the next session start.
- If the file is created, state the path that was created and show the exact JSON
  template in a fenced `json` block.
- Always finish with a short reminder list covering optional fields, next-session
  activation, and the purpose of `postToolFormatCommands` when present.
