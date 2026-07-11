# productivity

Productivity helpers for administrative and daily tasks.

## Install

Install this plugin globally so it's available across all your projects:

```
/plugin install productivity --scope user
```

Then install the recommended skills by typing the `install-recommended-skills`
skill name.

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

