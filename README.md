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
- **List + kanban views** with filters by status / assignee / project.
- **Launch AI on a task** — start Claude Code or OpenCode in the task's target
  repository with the task file as context.
- **Live sync** — file watching picks up edits made outside the app instantly.

### Planned

- Repository management (integrating [devdeck](https://github.com/atman-33/devdeck))
- Music player (integrating tube-loop-player)

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
