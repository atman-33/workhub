---
name: setup-zellij
description: Install Zellij and configure shell profiles to auto-launch Zellij on startup (replacing any existing herdr autostart block). Use when the user wants to install or configure Zellij's shell autostart.
disable-model-invocation: true
---

## Task

Install `zellij` terminal multiplexer and configure each shell profile (PowerShell and
WSL bash / zsh) to launch it automatically on startup — replacing any existing herdr
autostart block installed by `setup-herdr`.

## Steps

### 1. Check Zellij installation (per environment)

**PowerShell:**
Run `Get-Command zellij -ErrorAction SilentlyContinue` (or `zellij --version`).

**WSL:**
Run `wsl -- which zellij` (or `wsl -- zellij --version`).

If found in an environment, mark that environment "already installed" and skip to step 3
for it. If not found, continue to step 2 for that environment.

---

### 2. Install Zellij (only after user confirmation)

These are system-level installers — always show the exact command and get the user's
go-ahead before running it via Bash/PowerShell (same convention `setup-herdr` uses for
herdr's own install script).

**Windows:**
```powershell
winget install --id Zellij.Zellij -e
```

**WSL/Linux:**
```bash
sudo apt update && sudo apt install -y zellij
```

> If the distribution doesn't ship `zellij`, install it from Cargo instead:
> `cargo install --locked zellij` (or see https://zellij.dev).

If the user declines, mark that environment "skipped (declined)" and continue with the
other environment.

---

### 3. Configure shell profiles: remove herdr autostart, add Zellij autostart

Process the following **four profiles** independently: PowerShell 7 (`$PROFILE`),
Windows PowerShell, WSL bash, and WSL zsh (only if zsh is installed).

#### 3-A. PowerShell 7 profile

1. Get the profile path from `$PROFILE`.
2. If the file does not exist, create it along with its parent directory.
3. **Remove any existing herdr autostart block.** Look for the `# Auto-start herdr`
   comment; if present, remove it together with the block that follows through the
   matching closing `}`:
   ```powershell
   # Auto-start herdr
   if (-not $env:HERDR_ENV) {
       herdr
   }
   ```
   If not found, note "(nothing to remove)" and continue.
4. Read the file and check whether it contains `ZELLIJ` or `Auto-start Zellij`.
   If found, mark as "already configured" and skip to 3-B.
5. If not found, append the following at the end of the file:

   ```powershell
   # Auto-start Zellij
   if (-not $env:ZELLIJ) {
       $cwd = (Get-Location).Path
       zellij options --default-shell pwsh --default-cwd $cwd
   }
   ```

   > **Why `--default-cwd`?**
   > On Windows, Zellij does not inherit the CWD from the launching shell, so new
   > panes open in the user home directory. `--default-cwd` sets the working
   > directory for the Zellij session directly, without altering the shell command.
   > (`pwsh` = PowerShell 7 executable name on Windows)

#### 3-B. Windows PowerShell profile

1. Build the profile path without hardcoding the username:

   ```powershell
   $winPSProfile = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "WindowsPowerShell\Microsoft.PowerShell_profile.ps1"
   ```

   > **OneDrive redirect**: On systems where OneDrive syncs the Documents folder,
   > `GetFolderPath("MyDocuments")` returns the OneDrive path (e.g.
   > `C:\Users\...\OneDrive\Documents\...`). Do NOT hardcode
   > `C:\Users\...\Documents\...` — the actual profile will be on OneDrive and
   > the hardcoded path will silently miss it. Always use `GetFolderPath` or
   > resolve the path via PowerShell before reading/editing.

2. If the parent directory (`WindowsPowerShell\`) does not exist, create it with `New-Item -ItemType Directory -Force`.
3. If the file does not exist, create it.
4. **Remove any existing herdr autostart block** (same `# Auto-start herdr` → closing
   `}` detection as 3-A). If not found, note "(nothing to remove)" and continue.
5. Read the file and check whether it contains `ZELLIJ` or `Auto-start Zellij`.
   If found, mark as "already configured" and skip to 3-C.
6. If not found, append the following at the end of the file:

   ```powershell
   # Auto-start Zellij
   if (-not $env:ZELLIJ) {
       $cwd = (Get-Location).Path
       zellij options --default-shell powershell --default-cwd $cwd
   }
   ```

   > **Why `--default-cwd`?**
   > Same reason as 3-A. (`powershell` = Windows PowerShell 5.x executable name)

#### 3-C. WSL bash profile

1. Run `wsl -- test -f ~/.bashrc && echo exists` to check whether `~/.bashrc` exists.
2. **Remove any existing herdr autostart block.** Look for the `# Auto-start herdr`
   comment; if present, remove it together with the block that follows through the
   matching `fi` (e.g. `wsl -- sed -i '/# Auto-start herdr/,/^fi$/d' ~/.bashrc` — the
   block shape is fixed and known, so a range delete from the comment through the next
   `^fi$` is safe). If not found, note "(nothing to remove)" and continue.
3. Run `wsl -- grep -q "Auto-start Zellij" ~/.bashrc` to check for duplicates.
   (Match the literal comment marker `Auto-start Zellij`, **not** `ZELLIJ` — see the
   warning below for why.) If already present, skip to 3-D.
4. If not present, append the block by piping a **PowerShell single-quoted here-string**
   to WSL's stdin. The closing `'@` must sit at column 0:

   ```powershell
   @'

   # Auto-start Zellij
   if [[ -z "$ZELLIJ" ]]; then
       zellij
   fi
   '@ | wsl -- bash -c 'cat >> ~/.bashrc'
   ```

   > **⚠️ Why a here-string, not `printf`?**
   > A naive `wsl -- bash -c 'printf "...\$ZELLIJ..." >> ~/.bashrc'` passes the
   > format string through PowerShell → wsl → bash. The `\$ZELLIJ` escaping is
   > fragile and can be stripped, writing `if [[ -z "" ]]` instead of
   > `if [[ -z "$ZELLIJ" ]]`. Since `[[ -z "" ]]` is **always true**, Zellij then
   > launches unconditionally — including inside an existing session — causing
   > runaway nested Zellij/shell spawning that makes WSL unstable.
   > A single-quoted here-string is passed **verbatim** (no `$` expansion in
   > PowerShell), and `cat` appends stdin as-is, so the `$ZELLIJ` guard survives.
   > For the same reason, the dedup check in step 3 greps for `Auto-start Zellij`
   > (always written) rather than `ZELLIJ` (lost when the guard breaks).

#### 3-D. WSL zsh profile (only if zsh is installed)

1. Run `wsl -- which zsh` to check whether zsh is available. If not found, skip.
2. Run `wsl -- test -f ~/.zshrc && echo exists` to check whether `~/.zshrc` exists.
3. **Remove any existing herdr autostart block** (same detection/removal as 3-C, applied
   to `~/.zshrc`). If not found, note "(nothing to remove)" and continue.
4. Run `wsl -- grep -q "generate-auto-start" ~/.zshrc` first. If present, zsh already
   auto-starts Zellij via the official `zellij setup --generate-auto-start zsh` method;
   **mark as "already configured" and skip** (do not add a second manual block).
5. Otherwise run `wsl -- grep -q "Auto-start Zellij" ~/.zshrc` to check for the manual
   block. If already present, skip.
6. If neither is present, append the block via a PowerShell here-string piped to stdin
   (same technique and rationale as bash; the closing `'@` must sit at column 0):

   ```powershell
   @'

   # Auto-start Zellij
   if [[ -z "$ZELLIJ" ]]; then
       zellij
   fi
   '@ | wsl -- zsh -c 'cat >> ~/.zshrc'
   ```

---

### 4. Report results (follow the Output Format below)

## Output Format

```
## Zellij Setup

| Item                     | Status                                            |
|---------------------------|---------------------------------------------------|
| Zellij install (Windows)  | <Installed / Already installed / Skipped (declined)> |
| Zellij install (WSL/Linux)| <Installed / Already installed / Skipped (declined)> |

| Profile             | herdr block removed | Zellij autostart                                    | Profile Path |
|----------------------|----------------------|------------------------------------------------------|--------------|
| PowerShell 7         | <Yes / No / N/A>     | <Added / Already configured>                          | <$PROFILE path> |
| Windows PowerShell   | <Yes / No / N/A>     | <Added / Already configured>                          | <Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1> |
| WSL bash             | <Yes / No / N/A>     | <Added / Already configured>                          | ~/.bashrc |
| WSL zsh              | <Yes / No / N/A / zsh not installed> | <Added / Already configured / Already auto-starts via generate-auto-start> | ~/.zshrc |

### Actions taken
- <bulleted list of what was actually done>

### Next steps
- Open each shell in a new session and verify that Zellij starts automatically.
- If you are already inside a Zellij session, nested launches are suppressed via the `$ZELLIJ` variable.
```
