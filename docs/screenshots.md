# Taking the README screenshots

The images in the repository `README.md` are captured from
[`demo-vault/`](../demo-vault) — a vault full of fictional data — so that no
real task, note, or repository path ever ends up in the repository.

The vault is only half of it. The registered repositories on the **Repos** tab
live in the machine config at `~/.workhub/config.json`, not in the vault, so
pointing the app at the demo vault by hand still shows your own repositories.
Use the script; it swaps both.

## Procedure

1. **Close workhub.** It rewrites `config.json` on exit and would overwrite the
   demo config. (The script refuses to run while the app is open.)
2. **Turn demo mode on:**

   ```bash
   cd demo-vault/.demo
   node demo-mode.mjs on
   ```

   It backs up `~/.workhub/config.json` to `~/.workhub/config.real.json`,
   creates three throwaway git repositories under
   `%TEMP%\workhub-demo-repos\` (pass `--repos <dir>` for somewhere else), and
   writes a config pointing at both. It refuses to overwrite an existing
   backup. Node 20+, no dependencies.
3. **Start workhub** and check the window: dark theme, **1280 × 800**, update
   and template banners dismissed (demo mode turns both checks off already).
4. **Capture** the shots listed below into `docs/images/`, using exactly those
   file names — the README references them by name.
5. **Turn demo mode off:**

   ```bash
   node demo-mode.mjs off          # add --clean to delete the throwaway repos too
   ```

6. **Check what you are about to commit.** `git status demo-vault/` — a capture
   session rewrites `updated:` fields as you drag things around, which is fine.
   What must not land in a commit is machine state; the paths that carry it
   (`.workhub/`, `.claude/project-context.json`, `opencode.json`,
   `_ai/music/`, `attachments/ink/`) are gitignored precisely because the app
   fills them with your real config while demo mode is on. Then look at the
   images themselves for anything real: a taskbar, a notification, a window
   title, a path under your home folder.

## The shots

Capture at 1280 × 800 in the dark theme (the app's default).

| File | Tab | What to have on screen |
|---|---|---|
| `tasks-kanban.png` | Tasks | Kanban view, cards across Inbox → Done, filter row visible. The hero shot. |
| `tasks-edit-dialog.png` | Tasks | Edit Task dialog for **T-0003** — Markdown preview in Description, Results and launch buttons in the header. |
| `tasks-launch-agent.png` | Tasks | The **Launch agent** button on a card, ideally with the spawned terminal beside the window. |
| `projects.png` | Projects | `demo-app` selected, its detail pane showing the task counts, contents and layout findings. |
| `repos.png` | Repos | The three demo repositories with branch and dirty state; Changes or Worktrees panel open. |
| `schedule.png` | Schedule | `demo-app` → *2026Q3 release*, Calendar view, September visible so the bars, the arrow, the milestones and a holiday all show. |
| `mindmap.png` | Mindmap | `demo-app` → *architecture*, the whole map in view, the sticky on the quality branch visible. |
| `music.png` | Music | The player with the demo playlist. |
| `timer.png` | Timer | The countdown ring, mid-session. |
| `ink-overlay.png` | — | A few ink strokes over any (non-personal) screen, pen-colour chip visible. |
| `setup-vault.png` | Tasks | The first-launch vault picker with the **Init vault** flow. |

## Adding a shot

Prefer few images that stay true over one per tab. Every image is a thing that
silently goes stale, and the in-app **Help** tab — not the README — is where
each feature is documented in full.
