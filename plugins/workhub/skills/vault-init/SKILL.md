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
   `CLAUDE.md`, `AGENTS.md`, `.claude/` (settings.json,
   project-context.json, rules), `home.md`, `tasks/`, `projects/`,
   `knowledge/`, `inbox/`, `journal/`, `archive/`, `templates/`, `_ai/`,
   `attachments/`).
4. **Fix dates.** Replace the `created:` values in the copied `home.md` and
   `_index.md` files with today's date.
5. **Register the vault** so the app and skills can find it:
   - If `%APPDATA%\workhub\config.json` exists, set its `vault_path` to the
     target (create the key if missing, preserving all other content).
   - Otherwise tell the user to set the vault path in the workhub app's
     settings (or export `WORKHUB_VAULT`).
6. **Explain the vault harness setup** baked into the copied `.claude/`:
    - `settings.json` declares the `workhub-marketplace` (GitHub
      `atman-33/workhub`) via `extraKnownMarketplaces` and enables the
      required project-scope plugins (`workhub`, `engineering`). On the first
      Claude Code launch inside the vault the user just accepts the
      marketplace/plugin trust prompt — no manual install commands needed.
    - Recommend installing the user-scope plugin once per machine:
      `claude plugin install productivity@workhub-marketplace`.
    - Tell the user to register target repositories in
      `.claude/project-context.json` (`projects[]` entries with
      `name`/`path`, optional `summary`/`postToolFormatCommands`).
    - Mention that the workhub app launches AI tasks in a fresh herdr
      workspace by default; if they use herdr, run `setup-herdr` from the
      `productivity` plugin to install it and wire up the Claude Code /
      OpenCode integrations.
7. **Seed the common prompt.** The copied `CLAUDE.md` already carries the
   *Working agreement* — the rules every agent session in the vault follows
   (plan before building, ask instead of assuming, record decisions, confirm
   irreversible actions). Point the user at it, and set up the one part that
   is theirs alone:
   - `knowledge/profile/about-me.md` is a skeleton: who they are, their
     background, current work, agent preferences, and where the rest of their
     context lives (other vaults, Notion, GitHub, internal wikis).
   - Offer to draft it now from what is already known about them, and have
     them correct it — a rough first version they fix beats an empty one they
     never fill in. It grows over time.
   - The file is seeded once and never overwritten by a template sync, so it
     is safe to edit.
   - Mention **Settings → Commands → Custom prompt** in the app for a short
     personal delta appended to every task prompt; anything longer belongs in
     these two vault files instead (its whitespace collapses to single spaces).
8. **Suggest next steps**: open the folder as a vault in Obsidian, then
   create a first task in the workhub app or via `templates/task.md`, and
   start AI agent sessions with the vault as the working directory. For
   knowledge management, drop raw notes into `inbox/` and run `/kb-ingest`;
   `/kb-query`, `/kb-lint`, and `/kb-index` maintain and search the
   knowledge base.
