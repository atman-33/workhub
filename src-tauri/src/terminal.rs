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
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::storage;

pub(crate) struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Active PTY sessions, keyed by the frontend-chosen terminal id.
#[derive(Default)]
pub struct TerminalState(pub(crate) Mutex<HashMap<String, TerminalSession>>);

fn output_event(id: &str) -> String {
    format!("terminal-output:{id}")
}

fn exit_event(id: &str) -> String {
    format!("terminal-exit:{id}")
}

/// Opens (or reuses) a PTY session running the configured herdr client.
/// Spawns a background reader thread that forwards PTY output to the
/// frontend via `terminal-output:{id}` events and emits `terminal-exit:{id}`
/// (removing the session) when the child exits.
pub fn open(
    app: AppHandle,
    state: &TerminalState,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    {
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(&id) {
            return Ok(());
        }
    }

    let cfg = storage::load();
    let mut tokens = cfg.settings.herdr_cmd.split_whitespace();
    let program = tokens.next().unwrap_or("herdr");
    let mut cmd = CommandBuilder::new(program);
    for arg in tokens {
        cmd.arg(arg);
    }
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

    let session = TerminalSession {
        master: pair.master,
        writer,
        child,
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
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(&output_event(&id), text);
                }
            }
        }
        if let Some(term_state) = app.try_state::<TerminalState>() {
            if let Ok(mut sessions) = term_state.0.lock() {
                sessions.remove(&id);
            }
        }
        let _ = app.emit(&exit_event(&id), ());
    });

    Ok(())
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
