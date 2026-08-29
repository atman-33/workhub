//! Pure Alt double-press state machine for the ink overlay, ported from
//! Desktop Ink's `KeyboardHookManager` (C#/WPF). Timestamps are injected so
//! the logic is unit-testable without a live Win32 keyboard hook.
//!
//! Like the clips popup's `TapMachine`, the gesture only counts *bare* Alt
//! taps: an Alt press that is part of a real shortcut (Alt+Tab, Alt+F4, ...)
//! or that is held down for longer than the double-click threshold must not
//! arm the machine. Without that restriction an ordinary Alt shortcut leaves
//! the machine armed, the *first* press of the following gesture activates the
//! overlay, and the second press does nothing — which is what "the double
//! press sometimes does not work" looks like from the outside. Unlike the
//! clips gesture, this one fires on the second *press*, because the second
//! press is held down to draw.

/// Raw key transitions fed in from the low-level keyboard hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyInput {
    AltDown,
    AltUp,
    SDown,
    SUp,
    CDown,
    CUp,
    /// Any other key press — poisons the current gesture attempt.
    OtherDown,
}

/// Actions the overlay must perform in response to key input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InkEvent {
    /// Second Alt press landed within the double-click threshold and is held:
    /// show the overlay and start accepting strokes.
    Activate,
    /// The held Alt was released: clear all strokes and hide the overlay.
    Deactivate,
    /// S pressed while in temporary draw mode: cycle the pen color.
    CycleColor,
    /// C pressed while in temporary draw mode: save the annotated screen.
    /// Drawing continues — the gesture is not a way out of draw mode, so a
    /// single session can save several shots.
    Save,
}

/// A gap this long between two Alt presses with no release in between cannot
/// be key auto-repeat (the Windows repeat delay tops out at one second), so it
/// means the release was never delivered — the overlay window took focus away
/// from us, the session locked, an elevated window came up. Treat it as a
/// desync and recover instead of ignoring Alt until the state happens to
/// resynchronize.
const DESYNC_GAP_MS: u64 = 1500;

#[derive(Debug)]
pub struct AltStateMachine {
    /// Max gap between the first release and the second press, and max hold
    /// time of the first press (system double-click time).
    threshold_ms: u64,
    /// When the first tap's release landed.
    last_alt_release: u64,
    /// A first complete tap is on record and a second press is expected.
    armed: bool,
    /// When the currently held Alt was pressed, while it is not (yet) a
    /// drawing press. `None` means no Alt press is being tracked.
    alt_down_at: Option<u64>,
    /// The second press activated the overlay and is still held.
    is_alt_held: bool,
    /// Another key was pressed during the current attempt.
    poisoned: bool,
    is_s_held: bool,
    is_c_held: bool,
    /// Timestamp of the last Alt transition, for desync detection.
    last_alt_event: u64,
}

impl AltStateMachine {
    pub fn new(threshold_ms: u64) -> Self {
        Self {
            threshold_ms,
            last_alt_release: 0,
            armed: false,
            alt_down_at: None,
            is_alt_held: false,
            poisoned: false,
            is_s_held: false,
            is_c_held: false,
            last_alt_event: 0,
        }
    }

    pub fn on_key(&mut self, key: KeyInput, now_ms: u64) -> Option<InkEvent> {
        match key {
            KeyInput::AltDown => self.on_alt_press(now_ms),
            KeyInput::AltUp => self.on_alt_release(now_ms),
            KeyInput::SDown => {
                let was_held = std::mem::replace(&mut self.is_s_held, true);
                self.on_draw_key(was_held, InkEvent::CycleColor)
            }
            KeyInput::SUp => {
                self.is_s_held = false;
                None
            }
            KeyInput::CDown => {
                let was_held = std::mem::replace(&mut self.is_c_held, true);
                self.on_draw_key(was_held, InkEvent::Save)
            }
            KeyInput::CUp => {
                self.is_c_held = false;
                None
            }
            KeyInput::OtherDown => {
                self.poison();
                None
            }
        }
    }

    /// A key that means something only while drawing (S cycles the pen color,
    /// C saves). Edge-triggered, so holding it down does not repeat the
    /// action. Outside draw mode it is just another key, and pressing it
    /// poisons the gesture: Alt+S or Alt+C in some other app must not arm us.
    fn on_draw_key(&mut self, was_held: bool, event: InkEvent) -> Option<InkEvent> {
        if self.is_alt_held {
            return (!was_held).then_some(event);
        }
        self.poison();
        None
    }

    fn on_alt_press(&mut self, now_ms: u64) -> Option<InkEvent> {
        if self.is_alt_held {
            let stale = now_ms.wrapping_sub(self.last_alt_event) > DESYNC_GAP_MS;
            self.last_alt_event = now_ms;
            if !stale {
                // Key auto-repeat while holding — ignore.
                return None;
            }
            // The release was lost. Tear the overlay down and let this press
            // start a fresh gesture.
            self.reset();
            self.alt_down_at = Some(now_ms);
            return Some(InkEvent::Deactivate);
        }
        self.last_alt_event = now_ms;
        self.poisoned = false;
        if self.armed && now_ms.wrapping_sub(self.last_alt_release) <= self.threshold_ms {
            self.armed = false;
            self.alt_down_at = None;
            self.is_alt_held = true;
            return Some(InkEvent::Activate);
        }
        self.armed = false;
        self.alt_down_at = Some(now_ms);
        None
    }

    fn on_alt_release(&mut self, now_ms: u64) -> Option<InkEvent> {
        self.last_alt_event = now_ms;
        if self.is_alt_held {
            self.reset();
            return Some(InkEvent::Deactivate);
        }
        let Some(pressed_at) = self.alt_down_at.take() else {
            // A release with no press of ours on record — the other Alt key,
            // or a press that arrived while we were not listening. Leave the
            // pending arm alone rather than cancelling it.
            return None;
        };
        // Only a bare, short tap arms the gesture: a held Alt (menu access)
        // or one that carried a shortcut must not count as the first press.
        self.armed = !self.poisoned && now_ms.wrapping_sub(pressed_at) <= self.threshold_ms;
        self.last_alt_release = now_ms;
        self.poisoned = false;
        None
    }

    /// Cancel a pending arm, and mark a currently held (non-drawing) Alt press
    /// as part of a shortcut so its release does not arm the gesture.
    fn poison(&mut self) {
        if self.is_alt_held {
            // Shift snaps strokes; keys pressed while drawing are not our
            // business.
            return;
        }
        if self.alt_down_at.is_some() {
            self.poisoned = true;
        }
        self.armed = false;
    }

    fn reset(&mut self) {
        self.armed = false;
        self.alt_down_at = None;
        self.is_alt_held = false;
        self.poisoned = false;
        self.is_s_held = false;
        self.is_c_held = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use InkEvent::*;
    use KeyInput::*;

    const T: u64 = 500; // threshold

    fn machine() -> AltStateMachine {
        AltStateMachine::new(T)
    }

    #[test]
    fn double_press_within_threshold_activates() {
        let mut m = machine();
        assert_eq!(m.on_key(AltDown, 0), None);
        assert_eq!(m.on_key(AltUp, 100), None);
        assert_eq!(m.on_key(AltDown, 100 + T), Some(Activate));
    }

    #[test]
    fn slow_second_press_does_not_activate() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 100);
        assert_eq!(m.on_key(AltDown, 100 + T + 1), None);
        // ...but its release re-arms the wait, so a third press activates.
        assert_eq!(m.on_key(AltUp, 700), None);
        assert_eq!(m.on_key(AltDown, 800), Some(Activate));
    }

    #[test]
    fn release_while_held_deactivates() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 100);
        m.on_key(AltDown, 200);
        assert_eq!(m.on_key(AltUp, 5000), Some(Deactivate));
    }

    #[test]
    fn repeat_alt_down_while_held_is_ignored() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 100);
        assert_eq!(m.on_key(AltDown, 200), Some(Activate));
        // Auto-repeat WM_SYSKEYDOWN while holding.
        assert_eq!(m.on_key(AltDown, 300), None);
        assert_eq!(m.on_key(AltDown, 400), None);
        assert_eq!(m.on_key(AltUp, 500), Some(Deactivate));
    }

    #[test]
    fn s_cycles_color_only_while_active_and_edge_triggered() {
        let mut m = machine();
        // Outside temp mode: no-op.
        assert_eq!(m.on_key(SDown, 0), None);
        assert_eq!(m.on_key(SUp, 10), None);
        m.on_key(AltDown, 100);
        m.on_key(AltUp, 150);
        m.on_key(AltDown, 200);
        // Held S auto-repeats: only the edge fires.
        assert_eq!(m.on_key(SDown, 300), Some(CycleColor));
        assert_eq!(m.on_key(SDown, 350), None);
        assert_eq!(m.on_key(SUp, 400), None);
        assert_eq!(m.on_key(SDown, 450), Some(CycleColor));
        m.on_key(SUp, 460);
        assert_eq!(m.on_key(AltUp, 500), Some(Deactivate));
        assert_eq!(m.on_key(SDown, 600), None);
    }

    #[test]
    fn c_saves_only_while_active_and_edge_triggered() {
        let mut m = machine();
        // Outside temp mode: no-op (and Alt+C elsewhere must not arm us —
        // covered by alt_c_in_another_app_does_not_arm_the_gesture).
        assert_eq!(m.on_key(CDown, 0), None);
        assert_eq!(m.on_key(CUp, 10), None);
        m.on_key(AltDown, 100);
        m.on_key(AltUp, 150);
        m.on_key(AltDown, 200);
        // Held C auto-repeats: only the edge fires.
        assert_eq!(m.on_key(CDown, 300), Some(Save));
        assert_eq!(m.on_key(CDown, 350), None);
        assert_eq!(m.on_key(CUp, 400), None);
        assert_eq!(m.on_key(CDown, 450), Some(Save));
        m.on_key(CUp, 460);
        assert_eq!(m.on_key(AltUp, 500), Some(Deactivate));
        assert_eq!(m.on_key(CDown, 600), None);
    }

    #[test]
    fn saving_does_not_end_the_drawing_session() {
        // Alt+C is not a way out of draw mode: the overlay stays up and the
        // pen keeps working, so one gesture can produce several captures.
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 50);
        assert_eq!(m.on_key(AltDown, 100), Some(Activate));
        assert_eq!(m.on_key(CDown, 200), Some(Save));
        m.on_key(CUp, 210);
        assert_eq!(m.on_key(SDown, 300), Some(CycleColor));
        m.on_key(SUp, 310);
        assert_eq!(m.on_key(CDown, 400), Some(Save));
        m.on_key(CUp, 410);
        assert_eq!(m.on_key(AltUp, 500), Some(Deactivate));
    }

    #[test]
    fn alt_c_in_another_app_does_not_arm_the_gesture() {
        // Alt+C is a real shortcut elsewhere; it must behave like Alt+S.
        let mut m = machine();
        m.on_key(AltDown, 0);
        assert_eq!(m.on_key(CDown, 20), None);
        m.on_key(CUp, 40);
        assert_eq!(m.on_key(AltUp, 50), None);
        assert_eq!(m.on_key(AltDown, 100), None);
    }

    #[test]
    fn deactivate_resets_wait_state() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 100);
        m.on_key(AltDown, 200);
        m.on_key(AltUp, 300); // Deactivate — must not count as "first release".
        assert_eq!(m.on_key(AltDown, 350), None);
    }

    #[test]
    fn a_shortcut_does_not_arm_the_gesture() {
        // Alt+Tab, then the gesture: the shortcut's release used to arm the
        // machine, so the gesture's *first* press activated and its second
        // press did nothing.
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(OtherDown, 20); // Tab
        assert_eq!(m.on_key(AltUp, 50), None);
        assert_eq!(m.on_key(AltDown, 100), None);
        assert_eq!(m.on_key(AltUp, 150), None);
        assert_eq!(m.on_key(AltDown, 200), Some(Activate));
    }

    #[test]
    fn alt_s_in_another_app_does_not_arm_the_gesture() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        assert_eq!(m.on_key(SDown, 20), None);
        m.on_key(SUp, 40);
        assert_eq!(m.on_key(AltUp, 50), None);
        assert_eq!(m.on_key(AltDown, 100), None);
    }

    #[test]
    fn typing_between_the_taps_cancels_the_arm() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 50);
        m.on_key(OtherDown, 80); // typed a letter
        assert_eq!(m.on_key(AltDown, 120), None);
    }

    #[test]
    fn a_long_first_press_does_not_arm_the_gesture() {
        // Alt held for menu access, released, then pressed again promptly.
        let mut m = machine();
        m.on_key(AltDown, 0);
        assert_eq!(m.on_key(AltUp, T + 1), None);
        assert_eq!(m.on_key(AltDown, T + 100), None);
        // The short tap that follows arms normally.
        assert_eq!(m.on_key(AltUp, T + 150), None);
        assert_eq!(m.on_key(AltDown, T + 200), Some(Activate));
    }

    #[test]
    fn keys_pressed_while_drawing_do_not_break_the_session() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 50);
        assert_eq!(m.on_key(AltDown, 100), Some(Activate));
        m.on_key(OtherDown, 200); // Shift, to snap a stroke
        assert_eq!(m.on_key(AltUp, 300), Some(Deactivate));
    }

    #[test]
    fn a_lost_release_recovers_on_the_next_press() {
        // The overlay is active and the Alt release never arrives (session
        // locked, elevated window took focus). The next press must not be
        // swallowed as auto-repeat forever.
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 50);
        assert_eq!(m.on_key(AltDown, 100), Some(Activate));
        // ...no AltUp...
        assert_eq!(m.on_key(AltDown, 100 + DESYNC_GAP_MS + 1), Some(Deactivate));
        let base = 100 + DESYNC_GAP_MS + 1;
        assert_eq!(m.on_key(AltUp, base + 50), None);
        assert_eq!(m.on_key(AltDown, base + 100), Some(Activate));
    }

    #[test]
    fn the_other_alt_keys_release_does_not_cancel_the_arm() {
        // Left Alt tapped (arms), then right Alt pressed and both released in
        // the other order: the unmatched release must leave the arm intact.
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 50);
        // A stray release with no press on record.
        assert_eq!(m.on_key(AltUp, 80), None);
        assert_eq!(m.on_key(AltDown, 120), Some(Activate));
    }
}
