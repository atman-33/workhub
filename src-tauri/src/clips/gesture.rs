//! Pure double-tap state machine for the clips popup. Timestamps are injected
//! so the logic is unit-testable without live keyboard input.
//!
//! The gesture is a *bare* modifier tapped twice — press, release, press,
//! release — with no other key pressed anywhere in between. That restriction
//! is what makes Ctrl usable as a trigger at all: without it, two quick
//! `Ctrl+C` presses would look exactly like the gesture. It also fires on the
//! **second release** rather than the second press (which is what the ink
//! overlay does with Alt), so holding the modifier down to type a real
//! shortcut never triggers the popup.

/// Key transitions fed in from the raw-input listener.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TapInput {
    ModifierDown,
    ModifierUp,
    /// Any non-modifier key press — poisons the current gesture attempt.
    OtherDown,
}

#[derive(Debug)]
pub struct TapMachine {
    /// Max gap between the taps, and max hold time of the second tap
    /// (system double-click time).
    threshold_ms: u64,
    /// When the first tap's release landed.
    last_release: u64,
    modifier_held: bool,
    /// A first complete tap is on record and a second one is expected.
    armed: bool,
    /// Another key was pressed during the current attempt.
    poisoned: bool,
    /// When the (candidate) second tap was pressed.
    second_press: Option<u64>,
}

impl TapMachine {
    pub fn new(threshold_ms: u64) -> Self {
        Self {
            threshold_ms,
            last_release: 0,
            modifier_held: false,
            armed: false,
            poisoned: false,
            second_press: None,
        }
    }

    /// Returns true when the double tap just completed.
    pub fn on_key(&mut self, input: TapInput, now_ms: u64) -> bool {
        match input {
            TapInput::ModifierDown => {
                if self.modifier_held {
                    // Key auto-repeat while holding — ignore.
                    return false;
                }
                self.modifier_held = true;
                self.poisoned = false;
                self.second_press = if self.armed && self.gap_ok(now_ms) {
                    Some(now_ms)
                } else {
                    self.armed = false;
                    None
                };
                false
            }
            TapInput::ModifierUp => {
                self.modifier_held = false;
                if self.poisoned {
                    self.reset();
                    return false;
                }
                if let Some(pressed_at) = self.second_press.take() {
                    if now_ms.wrapping_sub(pressed_at) <= self.threshold_ms {
                        self.reset();
                        return true;
                    }
                }
                // Held too long, or this was the first tap: (re)arm from here.
                self.armed = true;
                self.last_release = now_ms;
                false
            }
            TapInput::OtherDown => {
                // Poisons both a modifier currently held down (Ctrl+C) and a
                // pending arm (tap Ctrl, then type something else).
                self.poisoned = self.modifier_held;
                self.armed = false;
                self.second_press = None;
                false
            }
        }
    }

    fn gap_ok(&self, now_ms: u64) -> bool {
        now_ms.wrapping_sub(self.last_release) <= self.threshold_ms
    }

    fn reset(&mut self) {
        self.armed = false;
        self.poisoned = false;
        self.second_press = None;
    }
}

#[cfg(test)]
mod tests {
    use super::TapInput::*;
    use super::*;

    const T: u64 = 500; // threshold

    fn machine() -> TapMachine {
        TapMachine::new(T)
    }

    #[test]
    fn bare_double_tap_fires_on_the_second_release() {
        let mut m = machine();
        assert!(!m.on_key(ModifierDown, 0));
        assert!(!m.on_key(ModifierUp, 50));
        assert!(!m.on_key(ModifierDown, 200));
        assert!(m.on_key(ModifierUp, 250));
    }

    #[test]
    fn slow_second_tap_does_not_fire() {
        let mut m = machine();
        m.on_key(ModifierDown, 0);
        m.on_key(ModifierUp, 50);
        assert!(!m.on_key(ModifierDown, 50 + T + 1));
        assert!(!m.on_key(ModifierUp, 50 + T + 50));
        // ...but that release re-arms, so a prompt third tap fires.
        assert!(!m.on_key(ModifierDown, 50 + T + 100));
        assert!(m.on_key(ModifierUp, 50 + T + 150));
    }

    #[test]
    fn holding_the_second_tap_too_long_does_not_fire() {
        let mut m = machine();
        m.on_key(ModifierDown, 0);
        m.on_key(ModifierUp, 50);
        m.on_key(ModifierDown, 100);
        assert!(!m.on_key(ModifierUp, 100 + T + 1));
    }

    #[test]
    fn repeated_shortcut_presses_never_fire() {
        // Ctrl+C twice in a row is the false-positive this guards against.
        let mut m = machine();
        for i in 0..2 {
            let base = i * 200;
            m.on_key(ModifierDown, base);
            m.on_key(OtherDown, base + 10);
            assert!(!m.on_key(ModifierUp, base + 40));
        }
    }

    #[test]
    fn typing_between_taps_cancels_the_gesture() {
        let mut m = machine();
        m.on_key(ModifierDown, 0);
        m.on_key(ModifierUp, 50);
        m.on_key(OtherDown, 80); // typed a letter
        m.on_key(ModifierDown, 120);
        assert!(!m.on_key(ModifierUp, 150));
    }

    #[test]
    fn auto_repeat_while_holding_is_ignored() {
        let mut m = machine();
        m.on_key(ModifierDown, 0);
        m.on_key(ModifierUp, 50);
        m.on_key(ModifierDown, 100);
        assert!(!m.on_key(ModifierDown, 130)); // auto-repeat
        assert!(!m.on_key(ModifierDown, 160));
        assert!(m.on_key(ModifierUp, 200));
    }

    #[test]
    fn firing_resets_so_a_third_tap_does_not_refire() {
        let mut m = machine();
        m.on_key(ModifierDown, 0);
        m.on_key(ModifierUp, 50);
        m.on_key(ModifierDown, 100);
        assert!(m.on_key(ModifierUp, 150));
        // The firing release must not double as the next gesture's first tap.
        m.on_key(ModifierDown, 200);
        assert!(!m.on_key(ModifierUp, 250));
    }
}
