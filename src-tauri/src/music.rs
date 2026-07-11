use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MusicPlaylistItem {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MusicPlaylist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub items: Vec<MusicPlaylistItem>,
}

/// Persisted music-player state. Lives in the vault's AI zone
/// (`_ai/music/playlists.json`): app-managed JSON, outside the human zone's
/// Markdown body-preservation rules.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MusicData {
    #[serde(default)]
    pub playlists: Vec<MusicPlaylist>,
    #[serde(default)]
    pub active_playlist_id: String,
    #[serde(default = "default_loop_mode")]
    pub loop_mode: String,
    #[serde(default)]
    pub is_shuffle: bool,
}

fn default_loop_mode() -> String {
    "all".to_string()
}

fn music_file(vault_path: &Path) -> PathBuf {
    vault_path.join("_ai").join("music").join("playlists.json")
}

/// Returns Ok(None) when no music data has been saved yet.
pub fn load(vault_path: &Path) -> Result<Option<MusicData>, String> {
    let file = music_file(vault_path);
    if !file.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn save(vault_path: &Path, data: &MusicData) -> Result<(), String> {
    if !vault_path.is_dir() {
        return Err(format!(
            "vault path is not a directory: {}",
            vault_path.display()
        ));
    }
    let file = music_file(vault_path);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    std::fs::write(&file, text).map_err(|e| e.to_string())
}

/// Fetches a video title via YouTube oEmbed (no API key required).
pub fn fetch_title(video_id: &str) -> Result<String, String> {
    let url = format!(
        "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D{video_id}&format=json"
    );
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    let body: serde_json::Value = agent
        .get(&url)
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    body.get("title")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "oEmbed response has no title".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "workhub-music-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_returns_none_when_file_missing() {
        let vault = temp_vault();
        assert_eq!(load(&vault).unwrap(), None);
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn save_then_load_round_trips() {
        let vault = temp_vault();
        let data = MusicData {
            playlists: vec![MusicPlaylist {
                id: "playlist-1".into(),
                name: "Playlist 1".into(),
                items: vec![
                    MusicPlaylistItem {
                        id: "V4UL6BYgUXw".into(),
                        title: Some("Aerith's Theme".into()),
                    },
                    MusicPlaylistItem {
                        id: "abcdefghijk".into(),
                        title: None,
                    },
                ],
            }],
            active_playlist_id: "playlist-1".into(),
            loop_mode: "one".into(),
            is_shuffle: true,
        };
        save(&vault, &data).unwrap();
        assert_eq!(load(&vault).unwrap(), Some(data));
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn save_rejects_missing_vault() {
        let missing = std::env::temp_dir().join("workhub-music-test-does-not-exist");
        let data = MusicData {
            playlists: vec![],
            active_playlist_id: String::new(),
            loop_mode: default_loop_mode(),
            is_shuffle: false,
        };
        assert!(save(&missing, &data).is_err());
    }

    #[test]
    fn missing_fields_get_defaults() {
        let vault = temp_vault();
        let file = music_file(&vault);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, r#"{"playlists":[]}"#).unwrap();
        let data = load(&vault).unwrap().unwrap();
        assert_eq!(data.loop_mode, "all");
        assert!(!data.is_shuffle);
        std::fs::remove_dir_all(&vault).ok();
    }
}
