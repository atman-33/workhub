---
description: Gotchas when editing the Claude Code mods in workhub-claude-mods
paths:
  - "plugins/workhub-claude-mods/**"
---

# workhub-claude-mods gotchas

- **A fractional Box spacing blanks the desktop pane.** `gap={0.25}` passed
  `claude plugin test` and validate, but a fresh Desktop session then drew no
  pane at all (0.3.2); removing it fixed it (0.3.3). Use whole numbers or none.
  Step names (`gap="xs"`) are rejected outright ("must be a finite number")
  although the type allows them. So row spacing cannot be tuned finely: a whole
  cell is a full line on desktop.
- **The test runner is not the app's engine.** `claude plugin test` on the PATH
  runs an older Claude Code than the Desktop app bundles
  (`%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe`). Run
  `<that exe> plugin test <folder>` too; it also shows what the app really draws.
  Its one known difference: with no vault the engine draws its own Pane, so the
  "outside a vault" test passes only on the older runner.
- **A mod only reaches a session after the Desktop app is restarted fully.**
  After an install or update, a new session in the old app process can still
  show the previous plugin list.
- **A `Button` takes a plain `label`, never a `Text` child.** The newer
  engine (2.1.330) draws `<Button><Text size="footnote">id</Text></Button>`, the
  older one refuses it ("needs a label") and the whole pane draws nothing. So a
  Button's size cannot be changed; use `label` only.
- **`Text size` blanks the pane on an engine older than 2.1.330.** It is refused
  as "Text prop size is not allowed" and the pane draws nothing. The mod asks for
  `size` only when `$.session.version()` reads 2.1.330 or later; keep it behind
  that check.
- **Mod test mounts must name the real plugin** (`plugin: 'workhub-claude-mods'`),
  or `ui.press` / `ui.select` find no element.
- **Do not chain test and PR commands with `;`.** A failing test run went on to
  open a PR once. Use `&&`.
