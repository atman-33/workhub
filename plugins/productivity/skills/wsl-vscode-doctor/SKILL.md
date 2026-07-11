---
name: wsl-vscode-doctor
description: Diagnose and fix `code .` failing to launch, or opening a disconnected Windows-side VS Code instead of a WSL-connected (Remote-WSL) window, in a herdr-spawned WSL shell.
disable-model-invocation: true
---

## Task

Diagnose why `code .` doesn't work (or opens the wrong window) in this WSL
shell, and patch `~/.zshrc` so it works going forward.

## Steps

1. **Check current state.** Run:

   ```bash
   command -v code
   echo "WSL_DISTRO_NAME=$WSL_DISTRO_NAME"
   echo "$PATH" | tr ':' '\n' | grep -i "Microsoft VS Code"
   ```

   > **Why check both?** The `code` launcher script shipped by the Windows
   > VS Code install detects "am I in WSL" via `$WSL_DISTRO_NAME`. Without
   > it, `code .` still runs, but it skips routing through the Remote-WSL
   > extension and opens a disconnected Windows-side window instead.

   Completion criterion: `code` resolves on `PATH` AND `WSL_DISTRO_NAME` is
   set. If both are true, report "already configured" and stop — no further
   steps needed.

2. **Locate the VS Code Windows install** (don't hardcode a username):

   ```bash
   VSCODE_BIN=$(ls -d /mnt/c/Users/*/AppData/Local/Programs/"Microsoft VS Code"/bin 2>/dev/null | head -1)
   ```

   Completion criterion: `$VSCODE_BIN` is a directory containing a `code`
   file. If nothing is found, report that VS Code isn't installed on the
   Windows side and stop.

3. **Find a known-good `WSL_DISTRO_NAME` value.** This session's own
   environment is the broken one, so borrow the value from another process
   on the same machine that already has it set correctly:

   ```bash
   for p in /proc/[0-9]*/environ; do
     v=$(tr '\0' '\n' < "$p" 2>/dev/null | grep '^WSL_DISTRO_NAME=')
     [ -n "$v" ] && echo "$v" && break
   done
   ```

   Completion criterion: got a `WSL_DISTRO_NAME=<value>` from a sibling
   process, or — if none is found — read `NAME=` from `/etc/os-release` as a
   fallback and note in the final report that it's a best-effort guess the
   user should verify.

4. **Patch `~/.zshrc`, idempotently.** Grep for the marker
   `# --- wsl-vscode-doctor:begin ---` first. If it's already there, skip
   this step (don't duplicate). Otherwise append:

   ```sh
   # --- wsl-vscode-doctor:begin ---
   export PATH="$PATH:<VSCODE_BIN from step 2>"
   export WSL_DISTRO_NAME="${WSL_DISTRO_NAME:-<value from step 3>}"
   # --- wsl-vscode-doctor:end ---
   ```

   Completion criterion: the marker block exists in `~/.zshrc` exactly once.

5. **Explain how to verify.** `~/.zshrc` changes only apply to new shells,
   so don't try to verify inside this one. Tell the user to open a new
   terminal/pane and run:

   ```bash
   command -v code && echo "$WSL_DISTRO_NAME"
   ```

   then `code .` in any project, and confirm a Remote-WSL connection by
   checking for a running server process:

   ```bash
   ps -ef | grep server-main.js
   ```

   If it's there, the window opened via Remote-WSL rather than as a
   disconnected Windows-side instance.

## Output Format

```
### wsl-vscode-doctor

**Status before:** code found: <yes/no> · WSL_DISTRO_NAME: <set/unset>
**Action:** <no changes needed | patched ~/.zshrc with PATH=... and WSL_DISTRO_NAME=...>
**Next step:** Open a new terminal/pane, run `code .`, and confirm with
`ps -ef | grep server-main.js` that a Remote-WSL window opened.
```

> **Root cause note:** this usually happens because a long-running herdr
> server process captured an incomplete environment (no Windows PATH, no
> `WSL_DISTRO_NAME`) at the time it started, and every pane it spawns since
> then inherits that same stale environment. Restarting the herdr server
> from a terminal *outside* the affected session would fix this at the
> source without needing this workaround — but it disconnects any session
> currently running inside that server, so only do that deliberately.
