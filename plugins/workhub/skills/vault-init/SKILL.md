---
name: vault-init
description: Initialize a new workhub Obsidian vault from the bundled template. Use when setting up workhub for the first time or creating a fresh vault at a given path.
argument-hint: "<target-path>"
---

# vault-init — Create a workhub vault from the template

## Steps

1. **Locate the template.** It ships with the workhub repository as
   `vault-template/` (this plugin lives in the same repo:
   `${CLAUDE_PLUGIN_ROOT}/../../vault-template`). If running from an
   installed plugin without the repo, ask the user for the workhub repo path.
2. **Check the target.** The target directory (argument, e.g.
   `C:/obsidian/workhub-vault`) must be empty or nonexistent. If it has
   content, stop and ask — never overwrite an existing vault.
3. **Copy** the entire `vault-template/` tree to the target (including
   `CLAUDE.md`, `home.md`, `tasks/`, `projects/`, `knowledge/`,
   `templates/`, `_ai/`, `attachments/`).
4. **Fix dates.** Replace the `created:` values in the copied `home.md` and
   `_index.md` files with today's date.
5. **Register the vault** so the app and skills can find it:
   - If `%APPDATA%\workhub\config.json` exists, set its `vault_path` to the
     target (create the key if missing, preserving all other content).
   - Otherwise tell the user to set the vault path in the workhub app's
     settings (or export `WORKHUB_VAULT`).
6. **Suggest next steps**: open the folder as a vault in Obsidian, then
   create a first task in the workhub app or via `templates/task.md`.
