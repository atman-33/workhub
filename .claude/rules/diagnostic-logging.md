---
paths:
  - "src-tauri/src/**"
---

# Diagnostic logging: use `diag!`, never `eprintln!`

`src-tauri/src/main.rs` carries
`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`, so the
**packaged build has no console** and anything written to stdout/stderr there
goes to a handle nobody can read. A build only users run is therefore the one
build that used to record nothing at all — which is how T-0251 ("the voice
indicator appears in the wrong place") became unfixable from a report: the
probes involved read *another process's* state at one instant, so re-running
them later in a dev build does not reproduce the moment.

**Every diagnostic in production code goes through `crate::diag!`**
(`src-tauri/src/diag.rs`). It takes the same arguments as `eprintln!` and fans
the line out to stderr (so the dev console is unchanged), to an in-memory ring
read by the Settings panel, and to `~/.workhub/logs/workhub.log`.

`eprintln!` / `println!` remain correct inside `#[cfg(test)]` — test output
belongs to the test harness, not to the user's log file.

## What is worth a line

The log's job is to let someone reconstruct what the app did from a report
written after the fact. Four rules follow from that, and T-0257 applied them
to the 45 lines the first version shipped with — almost all of which were
failures, which is not enough.

- **Record transitions, not counters.** The Settings panel shows live counters
  (`rawkey::diagnostics`), and every one of them is lost with the process. The
  log has to say *when* something happened: a listener rebuilt, a hotkey
  registered, a recording started.
- **Never log anything that fires on a timer.** The in-memory ring holds 500
  lines. The raw-input watchdog re-registers on idle with a backoff, so
  logging its successes would fill the ring overnight with "nothing happened"
  and push out the session someone actually wants to read. `reregister` skips
  the `WATCHDOG_REASON` case for exactly this reason; the rebuild that follows
  a genuine break is still logged.
- **An error shown to the user goes in the log too.** An error that appeared
  on screen and then vanished is the thing bug reports are written about.
  `voice::emit_error` is the worked example: one line at the single funnel
  every user-visible voice error passes through, rather than at each caller.
- **A feature with a fallback chain records which link won.** Failure-only
  logging makes the case where a fallback quietly carried the day completely
  invisible — which is how the voice indicator ended up in the wrong corner
  with every log line green (T-0251). See also
  `.claude/rules/focused-app-state.md`.

## Never log what the user wrote

The log file is plain text, and users are asked to paste it into bug reports.
It records **what the app did**, never **what the user said, typed or copied**:

- Forbidden: transcript text, clipboard contents, task/note bodies, file
  contents, anything typed into a form.
- Fine: durations, sizes, counts, error messages, window rects, which fallback
  branch won, which hotkey was registered.
- Paths are borderline. Log one only when the path is the thing that failed
  (a config file that would not parse), not as routine context.

This is a rule about the call site, because there is no filtering layer that
could catch it later.

## Size is bounded by rotation, not by a setting

The file rotates to `workhub.log.1` at 1 MiB and keeps one generation, so the
logs never exceed ~2 MiB however long the app runs. Do not add a retention
setting: a diagnostic log the user has to configure is one they will find
switched off on the day it was needed.

## The panic hook is the point of `diag::init()`

`diag::init()` runs as the first statement of `run()`, before anything else can
fail, and installs a panic hook that records the message, the location and the
thread name. Before it existed, a panicking background thread (the raw-input
listener, the vault watcher, an stt worker) left the feature silently dead in a
release build with nothing anywhere to say why. Keep the call first, and keep
the hook chaining to the previous one.
