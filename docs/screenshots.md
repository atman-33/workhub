# Taking the README screenshots

The images in the repository `README.md` are captured from
[`demo-vault/`](../demo-vault) — a vault full of fictional data — so that no
real task, note, or repository path ever ends up in the repository.

The vault is only half of it. The registered repositories on the **Repos** tab
live in the machine config at `~/.workhub/config.json`, not in the vault, so
pointing the app at the demo vault by hand would still show your own
repositories. Use the script; it swaps both.

## Procedure

1. **Close workhub.** It rewrites `config.json` on exit and would overwrite the
   demo config.
2. **Turn demo mode on:**

   ```powershell
   cd demo-vault/.demo
   ./demo-mode.ps1 -On
   ```

   It backs up `~/.workhub/config.json` to `~/.workhub/config.real.json`,
   creates three throwaway git repositories under
   `%TEMP%\workhub-demo-repos\`, and writes a config pointing at both. It
   refuses to run while workhub is open, and refuses to overwrite an existing
   backup.
3. **Start workhub** and check the window: dark theme, **1280 × 800**, no
   personal window title behind it, update and template banners dismissed
   (demo mode turns both checks off already).
4. **Capture** the shots listed in the table below into `docs/images/`, using
   exactly those file names — the README references them by name.
5. **Turn demo mode off:**

   ```powershell
   ./demo-mode.ps1 -Off        # add -Clean to delete the throwaway repos too
   ```

6. **Check what you are about to commit.** `git status demo-vault/` — a
   capture session can rewrite `updated:` fields as you drag cards around.
   Keep or discard them, but review the images themselves for anything real:
   a taskbar, a notification, a window title, a path under your home folder.

## The shots

Capture at 1280 × 800 in the dark theme (the app's default) unless a row says
otherwise.

| File | Tab | What to have on screen | State |
|---|---|---|---|
| `tasks-kanban.png` | Tasks | Kanban view, cards across Inbox → Done, filter row visible. The hero shot. | have |
| `tasks-edit-dialog.png` | Tasks | Edit Task dialog for **T-0003** — Markdown preview in Description, Results and launch buttons in the header. | have |
| `tasks-launch-agent.png` | Tasks | The **Launch agent** button on a card, ideally with the spawned terminal beside the window. | have |
| `repos.png` | Repos | The three demo repositories with branch and dirty state; Changes or Worktrees panel open. | have |
| `projects.png` | Projects | The project list with `demo-app` selected, its README rendered in the detail pane. | **needed** |
| `schedule.png` | Schedule | `demo-app` → *2026Q3 release*, Calendar view, August visible so the leave block and the milestones show. | **needed** |
| `mindmap.png` | Mindmap | `demo-app` → *architecture*, the whole map in view, the sticky on the quality branch visible. | **needed** |
| `music-timer.png` | Music / Timer | The music player and the timer, stitched side by side. | have |
| `ink-overlay.png` | — | A few ink strokes over any (non-personal) screen, pen-colour chip visible. | have |
| `setup-vault.png` | Tasks | The first-launch vault picker with the **Init vault** flow. | have |

"have" means an image with that name is already committed and still
representative; recapture it when the UI it shows changes. "needed" means the
README does not reference it yet — add the reference in the same change that
adds the file.

## Adding a shot

Prefer few images that stay true over one per tab. Every image is a thing that
silently goes stale, and the in-app **Help** tab — not the README — is where
each feature is documented in full.
