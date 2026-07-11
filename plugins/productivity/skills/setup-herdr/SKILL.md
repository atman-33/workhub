---
name: setup-herdr
description: Install herdr (terminal-native agent multiplexer), set up its Claude Code and OpenCode integrations, and configure shell profiles to auto-launch herdr on startup (replacing any existing Zellij autostart block). Use when the user wants to install or configure herdr.
disable-model-invocation: true
---

## Task

Install `herdr` (https://herdr.dev), a terminal-native agent multiplexer, wire up its
Claude Code / OpenCode integrations, and configure shell profiles so `herdr` launches
automatically on startup — replacing any existing Zellij autostart installed by
`setup-zellij`.

## Environment note: this session can be hosted on either side

This skill touches both a Windows environment and a WSL environment, and the agent
session driving it can be hosted on **either** — the interop direction flips accordingly:

- **Hosted in WSL:** reach Windows via `powershell.exe`/`pwsh.exe`, and read/edit
  Windows profile files directly at their `/mnt/c/...` path rather than shelling a
  multi-line edit through `powershell.exe -Command` — quoting an edit through a nested
  shell is fragile; a direct file edit is not (the same class of problem step 4's
  here-string warning describes).
- **Hosted on Windows:** reach WSL via `wsl -- <command>`, as this skill's snippets show
  by default.

Determine which applies once, then use the matching direction for every step below.
The same preference — direct file access over a shell-quoted command — also applies to
the idempotency checks in steps 1, 3, and 4: read a file's content and inspect it
rather than piping it through `grep`/`Select-String` across the interop boundary.

## Steps

### 1. Check herdr installation (per environment)

A PATH-only check false-negatives: herdr's own installer doesn't add itself to PATH
(see step 2), so the binary can be present — even running — without `Get-Command`/
`which` finding it. Check, in order, until one hits:

**Windows:** `Get-Command herdr -ErrorAction SilentlyContinue` → known install dirs
(e.g. `Test-Path "$env:LOCALAPPDATA\Programs\Herdr\bin\herdr.exe"`) → a running process
(`Get-Process herdr -ErrorAction SilentlyContinue`).

**WSL:** `which herdr` → `$HOME/.local/bin/herdr` (the installer's default target).

Record whichever path resolved it — step 4 needs it to invoke herdr if it never lands
on PATH. If found by any check, mark the environment "already installed" and skip to
step 3 for it. Only when every check is empty, continue to step 2 for that environment.

---

### 2. Install herdr (only after user confirmation)

These are official installers that download and execute a remote script — always show
the exact command and get the user's go-ahead before running it via Bash/PowerShell
(same convention as how `setup-harness` handles `uv`/`openspec` installs).

**WSL/Linux:**
```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

**Windows** (official support is currently **beta/preview**, ConPTY-based — mention this
to the user):
```powershell
irm https://herdr.dev/install.ps1 | iex
```

> The installer places the binary at `${HERDR_INSTALL_DIR:-$HOME/.local/bin}` (WSL) and
> does **not** edit any shell rc file itself — it only warns if that directory isn't
> already on `PATH`. If it warns, tell the user to add
> `export PATH="$HOME/.local/bin:$PATH"` to their shell profile (or note it as a
> follow-up; don't silently add it as part of this skill's own autostart block).

If the user declines, mark that environment "skipped (declined)" and continue with the
other environment.

---

### 3. Install integrations (idempotent check, then run)

For each environment where herdr is now present:

**Claude Code integration** (Windows and WSL): read `~/.claude/settings.json` directly
and check for an existing herdr hook entry, and check whether the hook script exists
(`~/.claude/hooks/herdr-agent-state.sh` on WSL, `herdr-agent-state.ps1` on Windows). If
both are present, mark "already configured"; otherwise run:
```bash
herdr integration install claude
```

**OpenCode integration** (WSL/Linux/macOS only — **not supported on Windows**; mark the
Windows environment "N/A" and don't attempt it there): check whether
`~/.config/opencode/plugins/herdr-agent-state.js` exists. If so, mark "already
configured"; otherwise run:
```bash
herdr integration install opencode
```

---

### 4. Configure shell profiles: remove Zellij autostart

> **PowerShell profile paths** — Do NOT hardcode `C:\Users\...\Documents\...`.
> - **PS7**: `$PROFILE` resolves correctly in all cases.
> - **Windows PowerShell**: build the path with
>   `Join-Path ([Environment]::GetFolderPath("MyDocuments")) "WindowsPowerShell\Microsoft.PowerShell_profile.ps1"`
>   so OneDrive-redirected Documents folders are handled automatically.
>   Direct file access (Read/Edit tool) at the resolved path is more reliable than
>   shelling a multi-line edit through `powershell.exe -Command`.

Process the same **four profiles** as `setup-zellij`, independently: PowerShell
7 (`$PROFILE`), Windows PowerShell (path resolved via `GetFolderPath` above),
WSL `~/.bashrc`, and WSL `~/.zshrc` (only if zsh is installed).

For each profile, remove any existing Zellij autostart block.

Zellij's autostart shows up in **two** forms — check for and remove whichever is
present:

**Manual block** (PowerShell profiles and WSL bash/zsh) — look for the `# Auto-start
Zellij` comment; if present, remove it together with the block that follows, through
the matching closing `}` (PowerShell) or `fi` (bash/zsh):

```powershell
# Auto-start Zellij
if (-not $env:ZELLIJ) {
    $cwd = (Get-Location).Path
    zellij options --default-shell <pwsh|powershell> --default-cwd $cwd
}
```
```bash
# Auto-start Zellij
if [[ -z "$ZELLIJ" ]]; then
    zellij
fi
```
(e.g. `sed -i '/# Auto-start Zellij/,/^fi$/d' ~/.bashrc` for bash/zsh — the block shape
is fixed and known, so a range delete from the comment through the next `^fi$` is safe.)

**Official zsh method** (WSL `~/.zshrc` only) — `setup-zellij` also recognizes Zellij's
own `zellij setup --generate-auto-start zsh` mechanism and skips adding a second block
when it finds one already there. If *this* skill finds that mechanism, it must still
remove it. Look for a line containing `generate-auto-start`; if present, remove it along
with its neighboring comment and any `ZELLIJ_AUTO_ATTACH` export:
```bash
# Zellij auto-attach (added by ...)
eval "$(zellij setup --generate-auto-start zsh)"
export ZELLIJ_AUTO_ATTACH=true
```

If neither form is found in a given profile, note "(nothing to remove)" and continue.

Also remove any existing `# Auto-start herdr` block if present (from a previous
`setup-herdr` run), as herdr is no longer auto-launched from profiles.

---

### 5. Report results (follow the Output Format below)

## Output Format

```
## herdr Setup

| Environment | herdr install | Claude Code integration | OpenCode integration |
|---------------|------------------|----------------------------|-------------------------|
| WSL/Linux      | <Installed / Already installed / Skipped (declined)> | <Installed / Already configured> | <Installed / Already configured> |
| Windows        | <Installed (beta) / Already installed / Skipped (declined)> | <Installed / Already configured> | N/A (not supported on Windows) |

| Profile             | Zellij autostart removed                                                   | Profile Path |
|-----------------------|-----------------------------------------------------------------------------|--------------|
| PowerShell 7          | <Yes / No / N/A>                                                            | <$PROFILE path> |
| Windows PowerShell    | <Yes / No / N/A>                                                            | <Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1> |
| WSL bash              | <Yes / No / N/A>                                                            | ~/.bashrc |
| WSL zsh               | <Yes (manual) / Yes (generate-auto-start) / No / N/A / zsh not installed>  | ~/.zshrc |

### Actions taken
- <bulleted list of what was actually done>

### Next steps
- Run `herdr --version` to double check the install landed correctly.
- Launch herdr manually with `herdr` (or the full path on Windows) to confirm it works.
```
