---
paths:
  - "src-tauri/src/**"
---

# Global keyboard input: use Raw Input, never WH_KEYBOARD_LL

Windows stops delivering `WH_KEYBOARD_LL` hook callbacks to this process
while **its own WebView2 child window holds keyboard focus** — the hook proc
is silently never called (verified empirically for the ink feature: with the
workhub webview focused, in-app diagnostics showed zero hook callbacks while
an independent process's LL hook received every event; intermittent with
injected input, near-constant with physical keys). LL hooks are also subject
to silent removal when a callback exceeds the low-level hook timeout.

For any feature that must observe global key state (like `src-tauri/src/ink/`),
use the **Raw Input API** instead:

- `RegisterRawInputDevices` with `RIDEV_INPUTSINK` targeting a message-only
  window (`HWND_MESSAGE` parent) on a dedicated thread with its own message
  loop; handle `WM_INPUT` → `RAWKEYBOARD`.
- Delivery is via the normal message queue, independent of focus, outside the
  system hook chain, and inherently observe-only (keys are never consumed).
- Note: raw input reports Alt as the generic `VK_MENU` (left/right via
  `RI_KEY_E0`), unlike LL hooks which report `VK_LMENU`/`VK_RMENU`, and
  `RAWKEYBOARD` carries no timestamp — take the *message post* time
  (`GetMessageTime()`, rebased onto `GetTickCount64()`; see
  `rawkey::message_time_ms`) rather than the tick count at handling time, or a
  stalled queue stretches the gaps a gesture recognizer measures.
- Raw input is subject to **UIPI**: while a window of a higher-integrity
  (elevated) process is in the foreground, a normal-privilege process receives
  no keyboard input at all. Global gestures are simply dead there; say so in
  the help screen instead of trying to work around it.

## There is exactly one listener per process — share it

`RegisterRawInputDevices` registers a usage page/usage for the whole
**process**. A second call for the keyboard usage silently replaces the first
one's `hwndTarget`, so a feature that starts its own listener steals every key
from the feature that started earlier — with no error anywhere.

`src-tauri/src/rawkey.rs` therefore owns the single registration and fans
`WM_INPUT` out to named consumers (`register(app, "ink", cb)` /
`unregister("ink")`), starting the thread with the first consumer and stopping
it with the last. **A new global-key feature registers a consumer there; it
never calls `RegisterRawInputDevices` itself.** Consumer callbacks run on the
listener thread and must hop to the main thread (`run_on_main_thread`) before
touching windows.

Keep gesture-detection logic (e.g. `ink/state.rs`, `clips/gesture.rs`) pure
with injected timestamps so it stays unit-testable without live input.

## A registration that was accepted can stop delivering — recover from it

`RegisterRawInputDevices` succeeding at startup is not a promise that
`WM_INPUT` keeps arriving. Delivery can stop later, with **no error reported
anywhere**: locking the session, an RDP disconnect/reconnect, a fast user
switch, resuming from sleep, or a display/device reconfiguration. From the
user's side this is "the gesture works until I use the machine for a while,
and an app restart fixes it" — which is easy to misread as a bug in the
gesture recognizer, so check the listener first.

`rawkey.rs` therefore does the following, and a new global-key feature inherits
all of it for free by registering a consumer:

- **Re-register on the events that break delivery** — `WM_WTSSESSION_CHANGE`
  (needs `WTSRegisterSessionNotification`), `WM_DISPLAYCHANGE`,
  `WM_INPUT_DEVICE_CHANGE` (needs the `RIDEV_DEVNOTIFY` flag), and
  `WM_POWERBROADCAST`. Re-registering the same `hwndTarget` is idempotent and
  cheap, so acting on a false positive costs nothing.
- **Watch for silence** — a timer re-registers, with a doubling backoff, after
  a long stretch with no `WM_INPUT` at all. Silence is not proof of breakage
  (the user may be away), which is exactly why the response has to be a
  harmless re-registration rather than anything louder.
- **Recover from a dead listener from the outside** — every recovery that
  lives *inside* the listener thread dies with it. A separate watchdog thread
  polls (every 30 s) that the listener thread is alive
  (`JoinHandle::is_finished`) and that `GetRegisteredRawInputDevices` still
  maps the keyboard usage to the listener's own window with `RIDEV_INPUTSINK`.
  Both checks trip only on an unambiguously dead state (silence and UIPI are
  *not* such states); on a trip the whole listener — thread, window and
  registration — is rebuilt without joining the suspect thread. A wedged
  thread must never hang the recovery path, which is also why the departing
  thread's cleanup must not run `RIDEV_REMOVE` (it would silently kill the
  replacement's registration); the teardown path removes the device itself.
- **A consumer panic must not take the listener down** — consumer callbacks
  run inside `catch_unwind`, and all shared mutexes are read through a
  poison-tolerant lock. One broken consumer then costs one key event, not
  every gesture in the process.
- **Report health** — `rawkey::diagnostics()` behind the
  `input_listener_diagnostics` command, rendered by
  `src/components/input-listener-panel.tsx`. Without it, "the gesture stopped
  working" cannot be told apart from a gesture that is recognized but whose
  effect is invisible. `running` must reflect the thread's *actual* liveness
  (checked via the join handle), not the mere presence of a recorded listener;
  automatic rebuilds are counted and carry their reason.

**Re-applying a feature's settings must reach the registration.** Toggling a
feature off and on is what users do when a gesture dies, so `rawkey::register`
asks the listener to re-register whenever it is already running, and the
feature-level `start`/`apply_gesture` functions must not early-return on their
own "already running" flag — that flag drifting out of sync with the real state
is precisely the case that needs recovering.

## A modifier double-tap must be a *bare* double tap

A recognizer that arms on any modifier release is wrong, and the symptom is
misleading: the user reports that the gesture "sometimes does nothing". What
actually happens is that an ordinary shortcut (Alt+Tab, Ctrl+C) armed the
machine, so the gesture's **first** press completed it — fired and tore down
again in a few hundred milliseconds — and the second press then found nothing
armed. Both recognizers therefore require:

- **No other key pressed during the attempt.** Feed every other key press into
  the machine (`OtherDown` / `TapInput::OtherDown`); it poisons a modifier
  currently held (Ctrl+C) *and* a pending arm (tap, then type).
- **The tap is short.** A press held longer than the double-click threshold is
  menu access or a shortcut, not the first half of a gesture.
- **Recovery from a lost release.** A release is genuinely never delivered when
  the session locks or an elevated window takes focus mid-gesture. Without
  recovery the "modifier held" flag sticks and every later press is discarded
  as auto-repeat. A press arriving long after the last transition (longer than
  the 1 s maximum keyboard repeat delay) cannot be auto-repeat — treat it as a
  desync, reset, and start over from that press.
- **Ignore unmatched releases.** The left and right modifier keys arrive as one
  generic VK, so a release with no press of ours on record is normal; it must
  not cancel a pending arm.
