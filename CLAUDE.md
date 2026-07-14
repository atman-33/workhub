# workhub

workhub — a Tauri 2 desktop "All-in-one Dev Hub" (Rust backend +
React/TypeScript/shadcn-ui frontend), based on the devdeck codebase.
Task management for humans and AI agents (Claude Code / OpenCode) backed by a
dedicated Obsidian vault; repository management and a music player are planned
as later modules.

## Commands

```powershell
npm install                # frontend dependencies (first time)
npm run tauri dev          # run the app with hot reload (or: npm run tauri:dev)
npx tauri build --no-bundle # release build -> src-tauri/target/release/workhub.exe
npm run build              # typecheck + build frontend only

# in src-tauri/
cargo test                 # unit tests (on the local windows-gnu toolchain use
                           #   `cargo test --release` — debug test exes fail to
                           #   load with STATUS_ENTRYPOINT_NOT_FOUND)
cargo fmt                  # format (CI enforces --check)
cargo clippy -- -D warnings # lint (CI enforces)
```

## Architecture

Backend (`src-tauri/src/`):

| Module | Responsibility |
|---|---|
| `lib.rs` / `main.rs` | Tauri builder, command registration |
| `commands.rs` | `#[tauri::command]` layer exposed to the frontend |
| `models.rs` | domain types (`Task`, `Project`, `Settings`, `Config`, ...) |
| `tasks.rs` | task Markdown parsing/writing, vault file watching, `_ai/index/tasks.json` |
| `git.rs` | git CLI integration (kept from devdeck for the repos module) |
| `actions.rs` | external launches (VS Code, terminal, AI agent with task context) |
| `storage.rs` | JSON persistence (`%APPDATA%\workhub\config.json`) |
| `ink/` | screen-annotation overlay: WH_KEYBOARD_LL Alt double-press hook + transparent draw window (`overlay.html` / `src/overlay/main.ts`) |
| `update.rs` | self-update against GitHub Releases (disabled by default; no releases yet) |

Frontend (`src/`): React 19 + Tailwind v4 + shadcn/ui. `lib/api.ts` wraps
`invoke()` with types matching the Rust structs (snake_case fields; command
*parameters* are camelCase — Tauri converts).

Blocking work (git calls, vault scans) runs via
`tauri::async_runtime::spawn_blocking` in commands — never on the UI thread.

## Data model: the vault is the source of truth

Task data lives as Markdown + YAML frontmatter in a dedicated Obsidian vault
(dev vault: `C:/repos/workhub-vault`, template: `vault-template/`).
The app must:

- treat frontmatter as the schema (`id`, `title`, `status`, `assignee`,
  `project`, `priority`, `model`, `due`, `tags`, `created`, `updated`);
- rewrite only the frontmatter keys it manages and **preserve the body** of
  task files (human/AI-written prose);
- pick up external edits (Obsidian, AI agents) via file watching;
- English folder names in the vault are lowercase kebab-case (`tasks/`,
  `knowledge/`, `_ai/`).

Design docs live in the owner's vault:
`C:/repos/workhub-vault/projects/workhub/`.

## Plugin marketplace: the repo is the plugin source

This repository doubles as a Claude Code plugin marketplace
(`.claude-plugin/marketplace.json` + `plugins/`) — the single source of
plugins for the workhub vault harness. Skills live in plugins, never in
`vault-template/`; the vault carries configuration only. Each plugin is
classified required/optional and user/project scope — see
[docs/plugins.md](docs/plugins.md) for the catalog and the placement rules
before adding or moving a skill.

## Workflow

- Do all development on a feature branch cut from `main`
  (`feature/<short-name>`); open a PR into `main` when done. Don't commit
  directly to `main`.
- Any change that alters app behavior bumps `version` in
  `src-tauri/Cargo.toml` (semver) and adds a `CHANGELOG.md` entry in the same
  PR.

## Rules

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).
- Before committing: `cargo fmt`, `cargo clippy -- -D warnings`,
  `cargo test --release`, and `npm run build` (typecheck) must pass.
- Shell out to the `git` CLI for git operations; do not introduce libgit2.

<important>
- Config compatibility: `%APPDATA%\workhub\config.json` is read by every
  released version — only add fields with `#[serde(default)]`, never rename
  or remove existing ones.
- Keep `crate-type` in `src-tauri/Cargo.toml` as plain rlib (no cdylib) —
  cdylib breaks windows-gnu debug builds ("export ordinal too large").
- Never write to the vault's human zone (`tasks/`, `projects/`, `knowledge/`)
  in ways that destroy hand-written body content; frontmatter-only updates
  must round-trip the body untouched.
</important>
