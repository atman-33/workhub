//! Snippet persistence for the clips popup.
//!
//! Stored at `~/.workhub/clips.json` rather than in the vault: the popup must
//! work before (or without) a vault being configured, the popup path reads
//! them on a keystroke, and the vault's human zone is hand-written Markdown
//! this app deliberately does not rewrite. Same temp-file + rename write as
//! `voice_history.rs`, so a crash mid-write never leaves a truncated file.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::storage;

/// One paste-ready snippet. List order *is* the display order — the frontend
/// sends the whole list back after a reorder, so there is no separate rank
/// field to keep in sync.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Clip {
    /// Stable id, minted by the frontend when the snippet is created.
    pub id: String,
    /// Short name shown in the popup list; falls back to the text when empty.
    #[serde(default)]
    pub label: String,
    /// The text that gets pasted.
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Clips {
    pub clips: Vec<Clip>,
}

/// `~/.workhub/clips.json`.
fn clips_file() -> PathBuf {
    storage::config_dir().join("clips.json")
}

/// Loads the snippet file, tolerating a missing or corrupt file by starting
/// empty (mirrors `storage::load`'s tolerance for config.json).
pub fn load() -> Clips {
    match std::fs::read_to_string(clips_file()) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Clips::default(),
    }
}

pub fn save(clips: &Clips) -> Result<(), String> {
    let dir = storage::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(clips).map_err(|e| e.to_string())?;
    let final_path = clips_file();
    let tmp_path = final_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())
}

/// The snippet with the given id, if it still exists.
pub fn find(id: &str) -> Option<Clip> {
    load().clips.into_iter().find(|c| c.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_deserialize_to_empty_strings() {
        let clips: Clips = serde_json::from_str(r#"{"clips":[{"id":"c1"}]}"#).unwrap();
        assert_eq!(
            clips.clips,
            vec![Clip {
                id: "c1".into(),
                label: String::new(),
                text: String::new(),
            }]
        );
    }

    #[test]
    fn unknown_root_shape_falls_back_to_empty() {
        // A corrupt/foreign file must not break startup.
        assert_eq!(
            serde_json::from_str::<Clips>("[]").unwrap_or_default(),
            Clips::default()
        );
    }
}
