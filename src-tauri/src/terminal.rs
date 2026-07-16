//! Embedded terminal backend: a native ConPTY (via `portable-pty`) running the
//! `herdr` client so the Tasks view can show live agent output in-app.
//!
//! Sessions are keyed by an opaque `id` chosen by the frontend (a stable
//! "main" id is used today so the panel reattaches to the same PTY across
//! show/hide or component remounts). `terminal_open` is idempotent: if a
//! session with the given id is already running, it is reused rather than
//! spawning a second PTY.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager};

use crate::storage;

pub(crate) struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Where PTY output goes. Swappable so a reattaching frontend (remount,
    /// reopen) can re-route the stream to its fresh channel; shared with the
    /// reader thread. Channels — unlike events — guarantee ordered delivery
    /// and are the intended IPC primitive for high-throughput streaming,
    /// which full-screen TUI redraws are.
    output: Arc<Mutex<Channel<String>>>,
}

/// Active PTY sessions, keyed by the frontend-chosen terminal id.
#[derive(Default)]
pub struct TerminalState(pub(crate) Mutex<HashMap<String, TerminalSession>>);

fn exit_event(id: &str) -> String {
    format!("terminal-exit:{id}")
}

/// Opens (or reuses) a PTY session running the configured herdr client.
/// Spawns a background reader thread that streams PTY output to the frontend
/// over `on_output` (an ordered IPC channel) and emits `terminal-exit:{id}`
/// (removing the session) when the child exits.
///
/// Returns `true` when an already-running session was reused — its output is
/// re-routed to the given channel, and the caller should force a full repaint
/// (the new xterm attaches blank and only sees output deltas from that point
/// on).
pub fn open(
    app: AppHandle,
    state: &TerminalState,
    id: String,
    cols: u16,
    rows: u16,
    on_output: Channel<String>,
) -> Result<bool, String> {
    {
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get(&id) {
            *session.output.lock().map_err(|e| e.to_string())? = on_output;
            return Ok(true);
        }
    }

    let cfg = storage::load();
    let mut tokens = cfg.settings.herdr_cmd.split_whitespace();
    let program = tokens.next().unwrap_or("herdr");
    let mut cmd = CommandBuilder::new(program);
    for arg in tokens {
        cmd.arg(arg);
    }
    // herdr refuses to start when it thinks it is nested inside another herdr
    // pane (HERDR_ENV is its recursion guard). workhub inherits that variable
    // when the app itself was launched from a herdr pane (e.g. `npm run tauri
    // dev` during development), but the embedded panel is an independent
    // terminal surface, not a nested pane — so drop the guard for the child.
    cmd.env_remove("HERDR_ENV");
    if let Some(vault) = cfg
        .settings
        .vault_path
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    {
        cmd.cwd(vault);
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The slave end is only needed to spawn the child; drop it so EOF on the
    // master reader is driven solely by the child's lifetime.
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let output = Arc::new(Mutex::new(on_output));
    let thread_output = Arc::clone(&output);

    let session = TerminalSession {
        master: pair.master,
        writer,
        child,
        output,
    };
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), session);

    // Blocking PTY reader: plain std::thread, not spawn_blocking, since it
    // outlives this command and runs for the session's whole lifetime.
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        // Carries a multi-byte UTF-8 character split across read chunks over
        // to the next iteration, so it is never mangled into U+FFFD (which
        // shifts TUI column alignment).
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let text = take_complete_utf8(&mut pending);
                    if !text.is_empty() {
                        if let Ok(channel) = thread_output.lock() {
                            let _ = channel.send(text);
                        }
                    }
                }
            }
        }
        if !pending.is_empty() {
            let text = String::from_utf8_lossy(&pending).into_owned();
            if let Ok(channel) = thread_output.lock() {
                let _ = channel.send(text);
            }
        }
        if let Some(term_state) = app.try_state::<TerminalState>() {
            if let Ok(mut sessions) = term_state.0.lock() {
                sessions.remove(&id);
            }
        }
        let _ = app.emit(&exit_event(&id), ());
    });

    Ok(false)
}

/// Drains the longest valid-UTF-8 prefix of `pending` into a `String`,
/// leaving an incomplete trailing multi-byte sequence (at most 3 bytes) in
/// place for the next read. Bytes that are outright invalid UTF-8 (not merely
/// incomplete) are lossy-decoded so the stream never stalls.
fn take_complete_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(_) => {
            let complete = std::mem::take(pending);
            String::from_utf8(complete).unwrap_or_default()
        }
        Err(e) if e.error_len().is_none() => {
            // Incomplete trailing sequence: keep it for the next chunk.
            let tail = pending.split_off(e.valid_up_to());
            let head = std::mem::replace(pending, tail);
            String::from_utf8(head).unwrap_or_default()
        }
        Err(_) => {
            let text = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            text
        }
    }
}

pub fn write(state: &TerminalState, id: &str, data: &str) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| format!("no terminal session: {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

pub fn resize(state: &TerminalState, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(id)
        .ok_or_else(|| format!("no terminal session: {id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

pub fn close(state: &TerminalState, id: &str) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::take_complete_utf8;

    #[test]
    fn complete_utf8_drains_everything() {
        let mut pending = "hello 罫線".as_bytes().to_vec();
        assert_eq!(take_complete_utf8(&mut pending), "hello 罫線");
        assert!(pending.is_empty());
    }

    #[test]
    fn incomplete_trailing_char_is_carried_over() {
        let bytes = "a┐".as_bytes(); // '┐' is 3 bytes
        let mut pending = bytes[..bytes.len() - 1].to_vec();
        assert_eq!(take_complete_utf8(&mut pending), "a");
        assert_eq!(pending, &bytes[1..bytes.len() - 1]);

        // Next chunk completes the character.
        pending.push(bytes[bytes.len() - 1]);
        assert_eq!(take_complete_utf8(&mut pending), "┐");
        assert!(pending.is_empty());
    }

    #[test]
    fn invalid_bytes_are_lossy_decoded_without_stalling() {
        let mut pending = vec![b'x', 0xff, b'y'];
        assert_eq!(take_complete_utf8(&mut pending), "x\u{fffd}y");
        assert!(pending.is_empty());
    }

    #[test]
    fn only_incomplete_prefix_returns_empty_and_keeps_bytes() {
        let mut pending = vec![0xe2, 0x94]; // first 2 bytes of '┐'
        assert_eq!(take_complete_utf8(&mut pending), "");
        assert_eq!(pending, vec![0xe2, 0x94]);
    }
}
