//! Pure Alt double-press state machine for the ink overlay, ported from
//! Desktop Ink's `KeyboardHookManager` (C#/WPF). Timestamps are injected so
//! the logic is unit-testable without a live Win32 keyboard hook.

/// Raw key transitions fed in from the low-level keyboard hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyInput {
    AltDown,
    AltUp,
    SDown,
    SUp,
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
}

#[derive(Debug)]
pub struct AltStateMachine {
    /// Max gap between first release and second press (system double-click time).
    threshold_ms: u64,
    last_alt_release: u64,
    is_alt_held: bool,
    waiting_for_second_press: bool,
    is_s_held: bool,
}

impl AltStateMachine {
    pub fn new(threshold_ms: u64) -> Self {
        Self {
            threshold_ms,
            last_alt_release: 0,
            is_alt_held: false,
            waiting_for_second_press: false,
            is_s_held: false,
        }
    }

    pub fn on_key(&mut self, key: KeyInput, now_ms: u64) -> Option<InkEvent> {
        match key {
            KeyInput::AltDown => self.on_alt_press(now_ms),
            KeyInput::AltUp => self.on_alt_release(now_ms),
            KeyInput::SDown => {
                if self.is_alt_held && !self.is_s_held {
                    self.is_s_held = true;
                    Some(InkEvent::CycleColor)
                } else {
                    None
                }
            }
            KeyInput::SUp => {
                self.is_s_held = false;
                None
            }
        }
    }

    fn on_alt_press(&mut self, now_ms: u64) -> Option<InkEvent> {
        if self.is_alt_held {
            // Key auto-repeat while holding — ignore.
            return None;
        }
        if self.waiting_for_second_press {
            self.waiting_for_second_press = false;
            if now_ms.wrapping_sub(self.last_alt_release) <= self.threshold_ms {
                self.is_alt_held = true;
                return Some(InkEvent::Activate);
            }
        }
        None
    }

    fn on_alt_release(&mut self, now_ms: u64) -> Option<InkEvent> {
        if self.is_alt_held {
            self.is_alt_held = false;
            self.waiting_for_second_press = false;
            self.is_s_held = false;
            Some(InkEvent::Deactivate)
        } else if !self.waiting_for_second_press {
            self.last_alt_release = now_ms;
            self.waiting_for_second_press = true;
            None
        } else {
            // Released again while waiting for the second press — cancel.
            self.waiting_for_second_press = false;
            None
        }
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
    fn deactivate_resets_wait_state() {
        let mut m = machine();
        m.on_key(AltDown, 0);
        m.on_key(AltUp, 100);
        m.on_key(AltDown, 200);
        m.on_key(AltUp, 300); // Deactivate — must not count as "first release".
        assert_eq!(m.on_key(AltDown, 350), None);
    }
}
