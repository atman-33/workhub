# Running the app from a git worktree (the wrong-code trap)

`src-tauri/tauri.conf.json` pins `devUrl` to `http://localhost:5173`, and
`vite.config.ts` sets `strictPort: true` on the same port. Nothing derives the
port from the checkout, so **every worktree competes for one port**.

If another checkout is already serving 5173 (the main working tree, another
task's worktree, another agent's session), `npm run tauri:dev` in your worktree
does *not* fail usefully:

- `beforeDevCommand` runs `npm run dev`, vite hits `Port 5173 is already in
  use` and exits 1;
- the Tauri window opens anyway and loads `http://localhost:5173` — **the other
  checkout's code**.

There is no error in the window. The app looks like it built and simply ignored
your change, which reads as a bug in the change rather than a stale bundle. Two
sessions have lost time to this.

**Before launching, confirm who owns 5173:**

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen |
  ForEach-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)").CommandLine }
```

Stop that server (or ask whoever owns it to) before starting yours; do not kill
another agent's dev session without asking. Running two app windows from two
checkouts at once is not possible as configured.

For a **frontend-only** check, a plain vite on a free port is enough and does
not touch 5173 — the UI renders without the Tauri backend (`api.*` calls fail,
views stay empty, but layout and CSS are faithful):

```powershell
npx vite --port 5199 --strictPort
```

That is the safe way to verify layout, breakpoints and styling from a worktree
while someone else holds the real dev server. Behaviour that needs the backend
still requires the app itself, and therefore the port.
