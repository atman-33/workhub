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
