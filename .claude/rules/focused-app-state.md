---
paths:
  - "src-tauri/src/**"
---

# Reading the focused app's state from a hotkey handler

Features that act on *another* app (voice dictation, clips, quick capture)
sometimes need to know something about it: what the caret rect is, what has
focus, what window is in front. Two constraints govern how that may be done.

## Never block the global-shortcut handler

`tauri_plugin_global_shortcut` callbacks run, on Windows, synchronously
inside WndProc. Anything slow there freezes not just workhub but the app the
user is typing into. Cross-process COM calls — UI Automation above all — are
easily slow enough to be noticed, and an unresponsive provider can stall one
for seconds.

So: from a hotkey handler, spawn a worker thread, do the probe there, and let
it finish the job (position the window, then show it). The visible cost is
that the window appears a few tens of milliseconds later, which is not worth
trading a possible freeze for. `voice::show_indicator_for_recording` is the
worked example, and `caret::probe_with_timeout` caps the wait at 300 ms —
a COM call cannot be cancelled, so a timed-out probe is abandoned rather than
killed, which is acceptable only because it is bounded work that happens at
most once per recording.

The same rule is why the indicator window is built at startup rather than
inside the handler (see the module docs in `voice.rs` and `quick_capture.rs`).

## UI Automation clients belong in the MTA

`CoInitializeEx(None, COINIT_MULTITHREADED)` — an STA client must pump
messages for UIA callbacks, which a throwaway probe thread does not do.
Treat `RPC_E_CHANGED_MODE` as "this thread already has an apartment": carry
on, but leave `CoUninitialize` to whoever initialised it.

## Which probe reaches which app

`GetGUIThreadInfo` (and the Win32 caret API generally) only covers classic
Win32 controls. Browsers, Electron apps and VS Code — where dictation
actually lands — report nothing there, so a Win32-only probe silently
degrades to its fallback everywhere that matters. UI Automation is what
reaches them; keep both, in that order, and keep a fallback that needs
neither.

Note also that a collapsed (degenerate) UIA text range returns *no* bounding
rectangles from several providers, Chromium included. Clone the range and
`ExpandToEnclosingUnit(TextUnit_Character)` before giving up.

## A rectangle from the last-resort probe is not necessarily a caret

When no text pattern can measure a selection, the only thing left to report
is the focused element's own bounding rectangle. For a single-line text box
that is a fine stand-in for the caret. For a browser viewport, an editor pane
or a canvas app it is the **whole window**, and anchoring a pop-up to it puts
the pop-up at a window corner — which is where the voice indicator kept
turning up in T-0251, with the mouse-cursor fallback never firing because the
placement had "succeeded".

So:

- **Tag the rect with where it came from** (`caret::CaretSource`). A caller
  cannot tell a caret from a window by looking at the numbers alone, and the
  two deserve different amounts of trust.
- **Sanity-check the size against the work area before anchoring**
  (`window_place::should_anchor`). A caret rect is one line of text; anything
  a sizeable fraction of the screen is not one, whatever its source says. Keep
  the threshold loose — it only has to separate "a line" from "a window".
- **A placement that cannot be trusted must report failure, not do its best.**
  The value of a fallback chain is that every link can decline; a link that
  always succeeds deletes the links after it.
- **Log which anchor won and what the probe returned.** "It appeared in a
  weird place" is otherwise unreproducible: the probe reads another process's
  state at one instant, and by the time anyone looks, the focus has moved on.
