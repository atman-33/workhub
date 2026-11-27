# workhub-claude-mods

Claude Code **mods** for a [workhub](https://github.com/atman-33/workhub) vault.
A mod changes Claude Code's own interface; this plugin carries them separately
from the required `workhub` plugin so that a mod problem never reaches it and
people who do not use the app are not affected.

## workhub-tasks

A sidebar pane listing the vault's tasks:

- sections Doing, Review, ToDo and today's Done (inbox is never shown);
- a project filter, remembered across sessions;
- the task id opens the task note in Obsidian, the `▤` glyph opens its backlog
  item (Windows `rundll32`, macOS `open`, Linux `xdg-open`);
- when the pane is closed, a quiet `Tasks` row above the prompt opens it again;
  `/workhub-tasks` does the same.

- a `⋯` button on each row opens a "Move to" dropdown: Done / Doing / ToDo / Review / Inbox / Archive as the row's status allows (Review can go back to Doing, Done back to Review), plus Mark blocked / Clear blocked. One pick does it; the app moves a task back. The change is made by the `workhub` plugin's `task-cli` (the newest installed copy; Archive needs `workhub` 0.54.0 or later);
- Inbox is hidden by default; the `▸ Inbox (N)` toggle next to the Done count shows it, and the choice is remembered.

The pane refreshes every 15 seconds. Right-click menus and drag and drop are not offered: a mod's API has neither for a pane's rows.

## Where it runs

Only inside a workhub vault. At session start the mod walks up from the
session's directory looking for a folder with both `tasks/` and `_ai/`. If there
is none it registers nothing and draws nothing, so it is safe at user scope.

## Install

Enable it from the workhub app's **Plugins** tab, or:

```
/plugin install workhub-claude-mods@workhub-marketplace
```

A mod is loaded when the session starts; open a new session after enabling it.
Requires a Claude Code build that supports `modules` in `hooks/hooks.json`.
Claude Code only: OpenCode has no equivalent.

## Develop

```
claude plugin validate plugins/workhub-claude-mods
claude plugin test plugins/workhub-claude-mods
```
