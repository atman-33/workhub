# demo-vault

A complete workhub vault filled with **fictional** data. It exists so the
screenshots in the repository's [`README.md`](../README.md) can be taken
without showing anyone's real tasks, notes, or repository paths.

Nothing here describes a real product, person, or repository. Every path,
URL, and name is made up.

## What's in it

| Path | What it shows |
|---|---|
| `tasks/` | Eleven tasks spread across every status, with AI and human assignees, and one each of blocked / worktree / plan-first |
| `projects/demo-app/` | A full project folder: PRD, roadmap, specs, dev-notes, backlog, a schedule and a mindmap |
| `projects/demo-site/` | A lighter second project, so the project switcher has something to switch to |
| `inbox/` | A couple of unfiled notes, plus one in `_wip/` that tidy is meant to ignore |
| `knowledge/` | One sample reference note |
| `.demo/` | The config and script used to point the app here — see [`docs/screenshots.md`](../docs/screenshots.md) |

## Using it

Do not point your everyday workhub at this folder by hand — the registered
repositories live in the machine config, not in the vault, so half a screenshot
would still be yours. Use the script instead:

```bash
cd demo-vault/.demo
node demo-mode.mjs on    # back up your config, install the demo one
# start workhub, take the screenshots
node demo-mode.mjs off   # put your own config back
```

The full procedure, including what each screenshot should contain, is in
[`docs/screenshots.md`](../docs/screenshots.md).

## Keeping it clean

The app writes machine state into the vault as it runs — indexes, logs, the
template manifest, and, more importantly, files it fills from *your* config:
`.workhub/settings.json` (your custom prompt and recurring rules),
`.claude/project-context.json` and `opencode.json` (your registered
repositories), plus `_ai/music/` and any ink capture under `attachments/ink/`.
All of those are gitignored (see the repository's `.gitignore`); the vault's
*content* is tracked. If a capture session leaves
unintended changes behind (a dragged card rewrites a task's `updated:` field,
for instance), either keep them or `git checkout demo-vault/` — both are fine,
as long as what lands in the repository is still fictional.
