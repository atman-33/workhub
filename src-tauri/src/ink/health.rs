//! Liveness bookkeeping for the ink overlay webview.
//!
//! The overlay window is created once and reused, and `overlay::activate`
//! only re-creates it when the window itself is gone. A WebView2 whose
//! renderer has crashed or hung leaves the window in place: `show()` still
//! succeeds and the gesture looks recognised, but nothing can be drawn. From
//! the outside that is exactly "Alt double-press stopped working", and
//! restarting the key listener cannot fix it because the keys were never the
//! problem (T-0399).
//!
//! So every activation carries a sequence number the page echoes back. An
//! activation left unanswered marks the overlay for a rebuild. The rebuild
//! waits until the gesture has ended, because tearing the window down while
//! Alt is held would throw away whatever is being drawn. This module is the
//! pure part of that — no windows, no clocks — so it can be tested.

/// How long the page has to answer an activation before it counts as dead.
pub const ACK_TIMEOUT_MS: u64 = 2_000;

/// Minimum spacing between two *automatic* rebuilds. A page that is merely
/// slow must not be torn down over and over; a manual restart ignores this.
pub const MIN_AUTO_REBUILD_INTERVAL_MS: u64 = 30_000;

/// What an activation needs to know to be followed up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Activation {
    pub seq: u64,
    /// Whether the answer will be checked. Activations sent before the page
    /// has reported that it is listening (right after a rebuild, while the
    /// page is still loading) would be lost for an innocent reason.
    pub checked: bool,
}

#[derive(Debug, Default)]
pub struct OverlayHealth {
    /// The last activation issued.
    seq: u64,
    /// The highest activation the page has answered.
    acked: u64,
    /// The page of the current window has reported it is listening.
    ready: bool,
    /// The overlay is shown for a gesture in progress.
    active: bool,
    /// An activation went unanswered; rebuild once the gesture has ended.
    needs_rebuild: bool,
    /// The activation whose missing answer set `needs_rebuild`.
    unanswered: u64,
    /// A rebuild is running; a second one must not start on top of it.
    rebuilding: bool,
    last_auto_rebuild_at: Option<u64>,
}

impl OverlayHealth {
    pub const fn new() -> Self {
        Self {
            seq: 0,
            acked: 0,
            ready: false,
            active: false,
            needs_rebuild: false,
            unanswered: 0,
            rebuilding: false,
            last_auto_rebuild_at: None,
        }
    }

    /// The overlay is being shown for a gesture.
    pub fn on_activate(&mut self) -> Activation {
        self.seq += 1;
        self.active = true;
        Activation {
            seq: self.seq,
            checked: self.ready,
        }
    }

    pub fn on_deactivate(&mut self) {
        self.active = false;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// The page has registered its listeners.
    pub fn on_ready(&mut self) {
        self.ready = true;
    }

    /// The page answered activation `seq`. A late answer to the activation
    /// that condemned the page proves it alive, so the rebuild is called off.
    pub fn on_ack(&mut self, seq: u64) {
        self.acked = self.acked.max(seq);
        self.ready = true;
        if self.needs_rebuild && seq >= self.unanswered {
            self.needs_rebuild = false;
        }
    }

    /// The answer window for a checked activation `seq` has elapsed. Returns
    /// true when it went unanswered, i.e. the page is presumed dead.
    pub fn on_timeout(&mut self, seq: u64) -> bool {
        if self.acked >= seq || self.rebuilding {
            return false;
        }
        self.needs_rebuild = true;
        self.unanswered = seq;
        true
    }

    /// Whether a rebuild should start now. `force` is the manual restart:
    /// it skips the "is anything wrong" and spacing checks, but still never
    /// runs two rebuilds at once. On `true` the caller must rebuild and then
    /// call [`Self::on_rebuilt`].
    pub fn take_rebuild(&mut self, now_ms: u64, force: bool) -> bool {
        if self.rebuilding {
            return false;
        }
        if !force {
            if !self.needs_rebuild || self.active {
                return false;
            }
            if let Some(last) = self.last_auto_rebuild_at {
                if now_ms.saturating_sub(last) < MIN_AUTO_REBUILD_INTERVAL_MS {
                    return false;
                }
            }
            self.last_auto_rebuild_at = Some(now_ms);
        }
        self.rebuilding = true;
        self.needs_rebuild = false;
        self.active = false;
        self.ready = false;
        true
    }

    /// The rebuild has finished (successfully or not).
    pub fn on_rebuilt(&mut self) {
        self.rebuilding = false;
    }

    /// A new window was created outside a rebuild (the window had vanished
    /// on its own): its page has not reported in yet.
    pub fn on_window_created(&mut self) {
        self.ready = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> OverlayHealth {
        let mut h = OverlayHealth::new();
        h.on_ready();
        h
    }

    #[test]
    fn an_answered_activation_is_healthy() {
        let mut h = ready();
        let a = h.on_activate();
        assert!(a.checked);
        h.on_ack(a.seq);
        assert!(!h.on_timeout(a.seq));
        h.on_deactivate();
        assert!(!h.take_rebuild(10_000, false));
    }

    #[test]
    fn activations_before_the_page_is_ready_are_not_checked() {
        let mut h = OverlayHealth::new();
        assert!(!h.on_activate().checked);
    }

    #[test]
    fn an_unanswered_activation_rebuilds_only_after_the_gesture_ends() {
        let mut h = ready();
        let a = h.on_activate();
        assert!(h.on_timeout(a.seq));
        // Still drawing: tearing the window down now would lose the strokes.
        assert!(!h.take_rebuild(10_000, false));
        h.on_deactivate();
        assert!(h.take_rebuild(10_000, false));
        // One rebuild at a time.
        assert!(!h.take_rebuild(10_001, true));
        h.on_rebuilt();
    }

    #[test]
    fn a_late_answer_calls_the_rebuild_off() {
        let mut h = ready();
        let a = h.on_activate();
        assert!(h.on_timeout(a.seq));
        h.on_ack(a.seq);
        h.on_deactivate();
        assert!(!h.take_rebuild(10_000, false));
    }

    #[test]
    fn an_answer_to_a_newer_activation_also_counts() {
        let mut h = ready();
        let first = h.on_activate();
        h.on_deactivate();
        let second = h.on_activate();
        h.on_ack(second.seq);
        assert!(!h.on_timeout(first.seq));
    }

    #[test]
    fn automatic_rebuilds_are_spaced_out() {
        let mut h = ready();
        let a = h.on_activate();
        h.on_deactivate();
        assert!(h.on_timeout(a.seq));
        assert!(h.take_rebuild(100_000, false));
        h.on_rebuilt();
        // The rebuilt page has not reported in yet, so this one is unchecked.
        assert!(!h.on_activate().checked);
        h.on_ready();
        let b = h.on_activate();
        h.on_deactivate();
        assert!(h.on_timeout(b.seq));
        assert!(!h.take_rebuild(100_000 + MIN_AUTO_REBUILD_INTERVAL_MS - 1, false));
        assert!(h.take_rebuild(100_000 + MIN_AUTO_REBUILD_INTERVAL_MS, false));
    }

    #[test]
    fn a_manual_rebuild_needs_no_reason_and_ignores_spacing() {
        let mut h = ready();
        assert!(h.take_rebuild(0, true));
        h.on_rebuilt();
        assert!(h.take_rebuild(1, true));
    }

    #[test]
    fn timeouts_during_a_rebuild_are_ignored() {
        let mut h = ready();
        let a = h.on_activate();
        h.on_deactivate();
        assert!(h.take_rebuild(0, true));
        assert!(!h.on_timeout(a.seq));
    }
}
