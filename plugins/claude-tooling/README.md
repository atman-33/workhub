# claude-tooling

Extending and maintaining Claude Code itself: the commands, skills and routines
you run it with, and the notice that tells you when a plugin is out of date.

## Install

Install at user scope so it is available from any working directory — the
update notice below only runs in projects where this plugin is enabled:

```
claude plugin install claude-tooling@workhub-marketplace
```

## Skills

| Skill | For |
|---|---|
| `create-claude-command` | a project's own `.claude/commands/` slash command |
| `install-skill` | installing a skill from a GitHub skills repository |
| `manage-desktop-routines` | Claude Code Desktop routines: create, back up, restore |

## Plugin update notifications

A `SessionStart` hook checks, every time a session starts, whether any of your
installed Claude Code plugins have a newer version available — across **all**
marketplaces, not just this one. When something is outdated it prints a short
notice with the exact update command, for example:

```
claude plugin update engineering@workhub-marketplace --scope project
```

Notes:

- **Install at user scope** (as above) so the check runs in every project.
- **Notify only** — it never updates anything for you. Updates require a Claude
  Code restart to take effect, so you run the command when convenient.
- **Offline** — it only reads Claude's local plugin state and the locally cached
  marketplace clones; it never hits the network. "Latest" is therefore as fresh
  as Claude Code's last marketplace refresh.
- **No spam** — each new version is announced only once per plugin/scope; a
  later version re-triggers the notice (tracked in
  `~/.claude/plugins/.update-notify-state.json`).
