//! Self-update against GitHub Releases.
//!
//! Contract with the release workflow (.github/workflows/release.yml):
//! - releases are tagged `vX.Y.Z` and the tag equals the Cargo.toml version
//! - every release carries a bare `workhub.exe` asset (exactly that name)
//!
//! Renaming the asset or changing the tag scheme breaks every installed copy.

use std::io::Read;
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
    let old = exe.with_extension("exe.old");

    std::fs::write(&new, &bytes).map_err(|e| format!("cannot write update: {e}"))?;
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old).map_err(|e| format!("cannot move current exe aside: {e}"))?;
    if let Err(e) = std::fs::rename(&new, &exe) {
        // roll back so the install keeps working
        let _ = std::fs::rename(&old, &exe);
        return Err(format!("cannot install update: {e}"));
    }
    Ok(())
}

/// Remove the leftover previous exe from an earlier update, if any.
pub fn cleanup_old() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("exe.old"));
        let _ = std::fs::remove_file(exe.with_extension("exe.new"));
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
}
