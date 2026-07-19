//! Self-update against GitHub Releases.
//!
//! Contract with the release workflow (.github/workflows/release.yml):
//! - releases are tagged `vX.Y.Z` and the tag equals the Cargo.toml version
//! - every release carries a bare `workhub.exe` asset (exactly that name)
//!
//! Renaming the asset or changing the tag scheme breaks every installed copy.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const REPO: &str = "atman-33/workhub";

pub fn current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn parse(v: &str) -> Option<(u64, u64, u64)> {
    let v = v.trim().trim_start_matches('v');
    let mut it = v.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next()?.parse().ok()?;
    Some((major, minor, patch))
}

pub fn is_newer(tag: &str, current: &str) -> bool {
    match (parse(tag), parse(current)) {
        (Some(remote), Some(local)) => remote > local,
        _ => false,
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("workhub/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// Returns (tag, download url of the workhub.exe asset) of the latest release,
/// or None if the check fails for any reason (offline, rate limit, no release).
pub fn check_latest() -> Option<(String, String)> {
    let resp = agent()
        .get(&format!(
            "https://api.github.com/repos/{REPO}/releases/latest"
        ))
        .call()
        .ok()?;
    let json: serde_json::Value = resp.into_json().ok()?;
    let tag = json.get("tag_name")?.as_str()?.to_string();
    let url = json
        .get("assets")?
        .as_array()?
        .iter()
        .find(|a| a.get("name").and_then(|n| n.as_str()) == Some("workhub.exe"))?
        .get("browser_download_url")?
        .as_str()?
        .to_string();
    Some((tag, url))
}

/// Builds the fallback "aside" path used when the fixed `<exe>.old` name is
/// still locked by a previous, still-running instance:
/// `<exe-file-name>.old-<unix millis>` (same scheme `self_replace` uses).
/// Kept as a pure function of the timestamp so it is unit-testable.
fn unique_old_name(exe: &Path, unix_millis: u128) -> PathBuf {
    let file_name = exe
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "workhub.exe".to_string());
    exe.with_file_name(format!("{file_name}.old-{unix_millis}"))
}

fn unique_old_path(exe: &Path) -> PathBuf {
    let unix_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    unique_old_name(exe, unix_millis)
}

/// Formats a rename/move failure with the destination path, adding a hint
/// when the failure looks like a file lock held by another running instance
/// (Windows os error 5, ACCESS_DENIED).
fn describe_move_error(action: &str, dest: &Path, e: &std::io::Error) -> String {
    let mut msg = format!("{action} {}: {e}", dest.display());
    if e.raw_os_error() == Some(5) {
        msg.push_str(" — close any other running workhub instances and try again");
    }
    msg
}

/// True if `file_name` (a bare file name, no directory) is a leftover from a
/// previous update for the exe named `exe_name` — either the fixed `.old`
/// name, a timestamped fallback (`<exe_name>.old-<millis>`), or a `.new`
/// staged download. Used by `cleanup_old` to sweep the exe's directory.
fn is_update_artifact(file_name: &str, exe_name: &str) -> bool {
    if file_name == format!("{exe_name}.new") || file_name == format!("{exe_name}.old") {
        return true;
    }
    match file_name.strip_prefix(&format!("{exe_name}.old-")) {
        Some(suffix) => !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()),
        None => false,
    }
}

/// Download the new exe and swap it in place of the running one.
/// Windows allows renaming a running exe, so: current -> .old, new -> current.
/// The caller is responsible for restarting the app afterwards.
pub fn apply_update(url: &str) -> Result<(), String> {
    let resp = agent()
        .get(url)
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(200 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("download read failed: {e}"))?;
    if bytes.len() < 1024 * 1024 {
        return Err(format!(
            "downloaded file is suspiciously small ({} bytes) — aborting",
            bytes.len()
        ));
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let new = exe.with_extension("exe.new");
    let fixed_old = exe.with_extension("exe.old");

    std::fs::write(&new, &bytes)
        .map_err(|e| format!("cannot write update to {}: {e}", new.display()))?;

    // Prefer the fixed `.old` name (matches earlier releases' behavior /
    // makes `cleanup_old` simpler in the common case); fall back to a unique
    // name only when the fixed one is still locked by an earlier instance.
    let old = if fixed_old.exists() {
        match std::fs::remove_file(&fixed_old) {
            Ok(()) => fixed_old,
            Err(_) => unique_old_path(&exe),
        }
    } else {
        fixed_old
    };

    std::fs::rename(&exe, &old)
        .map_err(|e| describe_move_error("cannot move current exe aside to", &old, &e))?;
    if let Err(e) = std::fs::rename(&new, &exe) {
        // roll back so the install keeps working, using the same aside path
        // that was actually used above
        let _ = std::fs::rename(&old, &exe);
        return Err(describe_move_error("cannot install update to", &exe, &e));
    }
    Ok(())
}

/// Remove leftover exes from earlier updates, if any: the fixed `.old`, any
/// timestamped `.old-<millis>` fallback, and staged `.new` downloads. Files
/// still locked by a running instance are left in place and retried on the
/// next launch — never treated as a failure.
pub fn cleanup_old() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    let exe_name = exe
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if is_update_artifact(name, &exe_name) {
            // Ignore failures: still locked by another instance, retry later.
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_tags() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("0.1.11", "0.1.9"));
        assert!(!is_newer("v0.1.0", "0.1.0"));
        assert!(!is_newer("v0.1.0", "0.2.0"));
        assert!(!is_newer("not-a-version", "0.1.0"));
    }

    #[test]
    fn unique_old_name_appends_timestamped_suffix() {
        let exe = Path::new(r"C:\Programs\workhub\workhub.exe");
        let got = unique_old_name(exe, 1_700_000_000_123);
        assert_eq!(
            got,
            Path::new(r"C:\Programs\workhub\workhub.exe.old-1700000000123")
        );
    }

    #[test]
    fn unique_old_name_is_unique_across_timestamps() {
        let exe = Path::new("workhub.exe");
        assert_ne!(unique_old_name(exe, 1), unique_old_name(exe, 2));
    }

    #[test]
    fn sweeps_fixed_old_timestamped_old_and_new() {
        assert!(is_update_artifact("workhub.exe.old", "workhub.exe"));
        assert!(is_update_artifact(
            "workhub.exe.old-1700000000123",
            "workhub.exe"
        ));
        assert!(is_update_artifact("workhub.exe.new", "workhub.exe"));
    }

    #[test]
    fn ignores_unrelated_files() {
        assert!(!is_update_artifact("workhub.exe", "workhub.exe"));
        assert!(!is_update_artifact("config.json", "workhub.exe"));
        assert!(!is_update_artifact("other.exe.old", "workhub.exe"));
        assert!(!is_update_artifact("workhub.exe.oldish", "workhub.exe"));
    }
}
