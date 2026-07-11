# workhub

**All-in-one Dev Hub** — task management for humans *and* AI agents, repository
management, and more, in one desktop app.

workhub is the home base for an AI-driven development style: humans and AI
agents (Claude Code / OpenCode) share one task board, task outcomes and
collected knowledge accumulate in a dedicated Obsidian vault, and everything —
the app, the Claude Code plugin, and the vault template — ships from this one
repository.

## Features

### Task management (MVP)

- **One board for humans and AI** — every task is a Markdown file with YAML
  frontmatter in the vault (`status`, `assignee: me | claude-code | opencode`,
  `project`, ...). The app, Obsidian, humans, and AI agents all read and write
  the same files.
- **List + kanban views** with filters by status / assignee / project, and
  drag & drop to change status or reorder within a column.
- **Launch AI on a task** — start Claude Code or OpenCode in the task's target
  repository (or in the vault for tasks without a project) with the task file
  as context.
- **Live sync** — file watching picks up edits made outside the app instantly.

### Planned

- Repository management (integrating [devdeck](https://github.com/atman-33/devdeck))
- Music player (integrating tube-loop-player)

## Install

Runtime requirements: `git` on PATH (for the Repos module).

### From GitHub Releases (recommended)

```powershell
$dir = "$env:LOCALAPPDATA\Programs\workhub"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest "https://github.com/atman-33/workhub/releases/latest/download/workhub.exe" -OutFile "$dir\workhub.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Open a new terminal and run:

```powershell
workhub
```

Each release also ships `workhub-windows-x86_64.zip` (exe + README + LICENSE)
and `SHA256SUMS.txt` if you prefer manual installation.

workhub checks GitHub Releases on startup; when a newer version exists, a
banner appears at the top — click **Update & restart**. The check can be
disabled in ⚙ Settings.

## Initial setup

### 1. Create the task vault

Tasks live in a dedicated Obsidian vault. On first launch the Tasks tab asks
you to choose a folder — pick an empty one (e.g. `C:/obsidian/workhub-vault`)
and press **Init vault** to expand the bundled template
([`vault-template/`](vault-template)) into it. You can also change the vault
later in ⚙ Settings → *Tasks vault path*.

Optionally open the same folder as a vault in Obsidian to browse and edit
tasks and notes directly.

### 2. Install the Claude Code plugin (user scope recommended)

The plugin gives Claude Code the `task-list` / `task-start` / `task-report` /
`vault-init` skills and the accompanying safety hooks. Install it **user
scope** so it is available in every repository a task may target:

```
claude
> /plugin marketplace add atman-33/workhub
> /plugin install workhub@workhub-marketplace
```

The skills locate the vault via `%APPDATA%\workhub\config.json` (written by
the app), or the `WORKHUB_VAULT` environment variable as an override — no
per-repository configuration is needed.

### 3. Run a task with AI

1. Create a task in the app and set `assignee` to `claude-code` (or
   `opencode`) and `project` to the target repository (short name under
   `C:/repos/<name>` or an absolute path; leave empty to run in the vault).
2. Press **Launch agent** on the task card. Claude Code starts in the target
   repository with the task file as context, runs `task-start` (status →
   `doing`), does the work, then `task-report` (results into the vault,
   status → `review`).
3. Review the result and move the task to `done` in the app — only humans
   close tasks.

## Repository layout

```
src/            # React frontend (React 19, Tailwind v4, shadcn/ui)
src-tauri/      # Rust backend (Tauri 2)
.claude-plugin/ # Claude Code marketplace definition
plugins/        # workhub Claude Code plugin (skills / hooks)
vault-template/ # initial template for the dedicated Obsidian vault
docs/
```

## Development

Requires Rust and Node.js 22+:

```powershell
npm install
npm run tauri dev           # run with hot reload
npx tauri build --no-bundle # release build -> src-tauri/target/release/workhub.exe
```

## License

MIT — based on [devdeck](https://github.com/atman-33/devdeck) (MIT).
