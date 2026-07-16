---
paths:
  - "src-tauri/src/terminal.rs"
  - "src-tauri/src/herdr.rs"
  - "src-tauri/src/actions.rs"
---

# herdr integration gotchas

## `HERDR_ENV` recursion guard — strip it for embedded/child herdr

herdr sets `HERDR_ENV` in every pane it spawns and uses it as a recursion
guard: any `herdr` invocation that sees `HERDR_ENV` in its environment
**refuses to start** ("nested herdr is disabled by default", exits
immediately). When workhub is itself launched from a herdr pane (common
during development: `npm run tauri dev` run inside herdr), the app inherits
`HERDR_ENV`, and any herdr subprocess it spawns inherits it too and dies.

The embedded terminal panel (`src-tauri/src/terminal.rs`) is an independent
terminal surface, **not** a nested herdr pane, so it must clear the guard
before spawning the herdr client:

```rust
cmd.env_remove("HERDR_ENV");
```

Any other place that spawns `herdr` as a child (`herdr.rs`, `actions.rs`)
must do the same if it can run while workhub was launched from herdr.
Symptom if forgotten: the terminal fills with repeated
"...too much herdr." refusal lines instead of the herdr TUI.

## herdr is client/server

herdr runs a persistent server (per named session, default `default`) over a
unix socket (`%APPDATA%\herdr\herdr.sock` on Windows). Multiple clients
attach to the same session, so the embedded panel and any external terminal
show the *same* workspaces. In embedded mode `herdr::ensure_server` must
**not** spawn an external `wt` window; it polls `is_server_running` and lets
the embedded client host/attach the server instead.
