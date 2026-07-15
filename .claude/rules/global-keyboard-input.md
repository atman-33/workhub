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
  `RAWKEYBOARD` carries no timestamp — use `GetTickCount64()`.

Keep gesture-detection logic (e.g. `ink/state.rs`) pure with injected
timestamps so it stays unit-testable without live input.
