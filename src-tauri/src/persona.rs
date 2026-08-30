//! persona — reads the `persona` Claude Code plugin's characters and its
//! persisted default, so the Persona tab can switch character without the
//! owner typing `/persona` in a session.
//!
//! Two files in the Claude config directory matter, and only one of them is
//! ours to write:
//!
//!   `persona.json`     the persisted default. Read at SessionStart, so a
//!                      change here takes effect in the *next* session. This
//!                      is what the tab writes.
//!   `.persona-active`  the session flag. Every running session re-reads it
//!                      each turn, so writing it from here would change the
//!                      character mid-conversation in every open terminal.
//!                      Never written by the app.
//!
//! `PERSONA_DEFAULT` in the environment beats both on read (see the plugin's
//! `hooks/persona-config.mjs`), so a write silently does nothing while it is
//! set — surfaced to the UI as `env_override` rather than failing quietly.
//!
//! Character discovery mirrors the plugin's own layers, earlier winning:
//!   1. `<claude-dir>/personas/<id>/character.md`                    (user)
//!   2. `<claude-dir>/plugins/cache/*/persona/*/characters/<id>/…`   (bundled)
//!
//! The plugin's project layer is deliberately inert upstream, so it is not
//! searched here either.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const LEVEL_IDS: [&str; 3] = ["light", "normal", "heavy"];
/// Sort position for a character that declares no `order:`.
const DEFAULT_ORDER: i64 = i64::MAX;
const DEFAULT_LEVEL: &str = "normal";

/// One intensity level of a character, with the prose that defines it.
#[derive(Debug, Clone, Serialize)]
pub struct PersonaLevel {
    /// `light` | `normal` | `heavy`
    pub id: String,
    /// Display label from the frontmatter (`level_normal: 明快`).
    pub label: String,
    /// Body of the matching level section, empty when absent.
    pub body: String,
}

/// A `## ` section of a character file that is not a level section.
#[derive(Debug, Clone, Serialize)]
pub struct PersonaSection {
    pub heading: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonaCharacter {
    pub id: String,
    pub name: String,
    pub source: String,
    pub statusline: String,
    /// `user` for a hand-made character, `bundled` for one shipped by the plugin.
    pub origin: String,
    pub file: String,
    /// Display position from the character file. Absent sorts last, so a
    /// hand-written character without the key still appears — at the end.
    pub order: i64,
    pub levels: Vec<PersonaLevel>,
    pub sections: Vec<PersonaSection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonaState {
    pub enabled: bool,
    pub character: Option<String>,
    pub level: String,
    /// True while `PERSONA_DEFAULT` is set, which makes any write ineffective.
    pub env_override: bool,
    pub config_path: String,
}

/// Shape of `<claude-dir>/persona.json`, as the plugin writes it.
#[derive(Debug, Default, Deserialize, Serialize)]
struct PersonaConfigFile {
    #[serde(skip_serializing_if = "Option::is_none")]
    character: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<String>,
    enabled: bool,
}

pub fn claude_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir().unwrap_or_default().join(".claude")
}

fn config_path() -> PathBuf {
    claude_dir().join("persona.json")
}

/// Label of a `## レベル: <label>` / `## Level: <label>` heading, or `None`
/// when the heading is an ordinary one. Both spellings are accepted so a
/// character file can be written entirely in English; the label itself is
/// whatever the frontmatter declares, in any language. Mirrors
/// `levelHeadingLabel` in the plugin's `hooks/persona-config.mjs` — the two
/// must agree, or the tab and the injected prompt disagree about which
/// sections are levels.
fn level_heading_label(heading: &str) -> Option<&str> {
    let rest = heading
        .strip_prefix("レベル")
        .or_else(|| strip_prefix_ignore_ascii_case(heading, "Level"))?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':').or_else(|| rest.strip_prefix('：'))?;
    Some(rest.trim())
}

fn strip_prefix_ignore_ascii_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

/// Same rule as the plugin's `CHARACTER_ID_RE`.
fn is_valid_character_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 32 {
        return false;
    }
    let first = id.chars().next().unwrap();
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Flat `key: value` frontmatter only — the plugin does not parse nesting
/// either, and a flat shape keeps hand-written character files unambiguous.
/// Returns the keys and the body that follows the closing `---`.
pub fn parse_frontmatter(text: &str) -> (BTreeMap<String, String>, String) {
    let normalized = text.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return (BTreeMap::new(), normalized);
    };
    let Some(end) = rest.find("\n---") else {
        return (BTreeMap::new(), normalized);
    };
    let block = &rest[..end];
    let after = &rest[end + 4..];
    let body = after.strip_prefix('\n').unwrap_or(after).to_string();

    let mut meta = BTreeMap::new();
    for line in block.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let valid_key = !key.is_empty()
            && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            && !key.starts_with(|c: char| c.is_ascii_digit());
        if !valid_key {
            continue;
        }
        let mut value = value.trim().to_string();
        for quote in ['"', '\''] {
            if value.len() > 1 && value.starts_with(quote) && value.ends_with(quote) {
                value = value[1..value.len() - 1].to_string();
                break;
            }
        }
        meta.insert(key.to_string(), value);
    }
    (meta, body)
}

/// Splits a character body into its `## ` sections, routing
/// `## レベル: <label>` (or `## Level: <label>`) to the level whose label
/// matches. HTML comments and
/// any prose before the first heading are dropped: the tab renders sections,
/// and the template's authoring notes are not content.
fn split_sections(
    body: &str,
    labels: &BTreeMap<String, String>,
) -> (Vec<PersonaSection>, BTreeMap<String, String>) {
    let mut sections = Vec::new();
    let mut level_bodies: BTreeMap<String, String> = BTreeMap::new();
    let mut heading: Option<String> = None;
    let mut buffer: Vec<&str> = Vec::new();

    // Reverse lookup: display label -> level id.
    let mut by_label: BTreeMap<&str, &str> = BTreeMap::new();
    for (id, label) in labels {
        by_label.insert(label.as_str(), id.as_str());
    }

    fn flush(
        heading: &Option<String>,
        buffer: &mut Vec<&str>,
        by_label: &BTreeMap<&str, &str>,
        sections: &mut Vec<PersonaSection>,
        level_bodies: &mut BTreeMap<String, String>,
    ) {
        let text = buffer.join("\n").trim().to_string();
        buffer.clear();
        let Some(h) = heading else {
            return;
        };
        if let Some(label) = level_heading_label(h) {
            if let Some(id) = by_label.get(label) {
                level_bodies.insert((*id).to_string(), text);
                return;
            }
        }
        sections.push(PersonaSection {
            heading: h.clone(),
            body: text,
        });
    }

    for line in body.lines() {
        if let Some(title) = line.strip_prefix("## ") {
            flush(
                &heading,
                &mut buffer,
                &by_label,
                &mut sections,
                &mut level_bodies,
            );
            heading = Some(title.trim().to_string());
            continue;
        }
        if heading.is_some() {
            buffer.push(line);
        }
    }
    flush(
        &heading,
        &mut buffer,
        &by_label,
        &mut sections,
        &mut level_bodies,
    );

    (sections, level_bodies)
}

fn load_character(dir: &Path, id: &str, origin: &str) -> Option<PersonaCharacter> {
    let file = dir.join(id).join("character.md");
    let raw = fs::read_to_string(&file).ok()?;
    let (meta, body) = parse_frontmatter(&raw);
    // The plugin requires the frontmatter id to match the folder; a mismatch
    // means the file was copied without being edited, so skip it rather than
    // offering a character that `/persona` cannot select.
    if meta.get("id").map(String::as_str) != Some(id) {
        return None;
    }

    let mut labels = BTreeMap::new();
    for level in LEVEL_IDS {
        let label = meta
            .get(&format!("level_{level}"))
            .cloned()
            .unwrap_or_else(|| level.to_string());
        labels.insert(level.to_string(), label);
    }
    let (sections, level_bodies) = split_sections(&body, &labels);

    let name = meta.get("name").cloned().unwrap_or_else(|| id.to_string());
    Some(PersonaCharacter {
        id: id.to_string(),
        statusline: meta
            .get("statusline")
            .cloned()
            .unwrap_or_else(|| name.clone()),
        name,
        source: meta.get("source").cloned().unwrap_or_default(),
        origin: origin.to_string(),
        order: meta
            .get("order")
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(DEFAULT_ORDER),
        file: file.to_string_lossy().replace('\\', "/"),
        levels: LEVEL_IDS
            .iter()
            .map(|id| PersonaLevel {
                id: (*id).to_string(),
                label: labels
                    .get(*id)
                    .cloned()
                    .unwrap_or_else(|| (*id).to_string()),
                body: level_bodies.get(*id).cloned().unwrap_or_default(),
            })
            .collect(),
        sections,
    })
}

/// Directories that may contain `<id>/character.md`, in precedence order.
/// Takes the Claude config directory rather than reading it, so the layering
/// can be tested against a temporary tree instead of the real home directory.
fn character_dirs(claude: &Path) -> Vec<(PathBuf, &'static str)> {
    let mut dirs = vec![(claude.join("personas"), "user")];

    // Bundled characters live under the plugin cache, whose middle segment is
    // the marketplace name and whose leaf is the installed version — neither
    // is knowable here, so both are walked rather than guessed.
    let cache = claude.join("plugins").join("cache");
    if let Ok(marketplaces) = fs::read_dir(&cache) {
        let mut found: Vec<PathBuf> = Vec::new();
        for marketplace in marketplaces.flatten() {
            let persona = marketplace.path().join("persona");
            let Ok(versions) = fs::read_dir(&persona) else {
                continue;
            };
            for version in versions.flatten() {
                let characters = version.path().join("characters");
                if characters.is_dir() {
                    found.push(characters);
                }
            }
        }
        // With several versions cached, take the highest path: readdir order
        // is not defined, and the later version is the one Claude Code loads.
        found.sort();
        if let Some(latest) = found.pop() {
            dirs.push((latest, "bundled"));
        }
    }
    dirs
}

/// Every character the plugin could select, earlier layers winning. An empty
/// result is how the app decides the `persona` plugin is not in use — the tab
/// is not shown at all in that case.
pub fn discover_characters() -> Vec<PersonaCharacter> {
    discover_characters_in(&claude_dir())
}

fn discover_characters_in(claude: &Path) -> Vec<PersonaCharacter> {
    let mut found: Vec<PersonaCharacter> = Vec::new();
    for (dir, origin) in character_dirs(claude) {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            // `_template` is authoring scaffolding, not a selectable character.
            if id.starts_with('_') || !is_valid_character_id(&id) {
                continue;
            }
            if found.iter().any(|c| c.id == id) {
                continue;
            }
            if let Some(character) = load_character(&dir, &id, origin) {
                found.push(character);
            }
        }
    }
    // Same ordering the plugin's `/persona` list uses, so the tab and the
    // command never disagree about where a character sits.
    found.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    found
}

pub fn read_state() -> PersonaState {
    let env_override = std::env::var("PERSONA_DEFAULT")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    let path = config_path();
    let parsed = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<PersonaConfigFile>(&raw).ok());

    let (enabled, character, level) = match parsed {
        Some(cfg) if cfg.enabled => (
            true,
            cfg.character.filter(|c| is_valid_character_id(c)),
            cfg.level
                .filter(|l| LEVEL_IDS.contains(&l.as_str()))
                .unwrap_or_else(|| DEFAULT_LEVEL.to_string()),
        ),
        Some(_) => (false, None, DEFAULT_LEVEL.to_string()),
        // No file yet: the plugin falls back to its own bundled default, which
        // is enabled. Report that rather than inventing a character id here.
        None => (true, None, DEFAULT_LEVEL.to_string()),
    };

    PersonaState {
        enabled,
        character,
        level,
        env_override,
        config_path: path.to_string_lossy().replace('\\', "/"),
    }
}

/// Writes `persona.json` through a temp file so a crashed write cannot leave
/// the plugin with a truncated config it would fail to parse.
pub fn write_state(
    enabled: bool,
    character: Option<String>,
    level: String,
) -> Result<PersonaState, String> {
    if enabled {
        let id = character
            .as_deref()
            .ok_or_else(|| "no character selected".to_string())?;
        if !is_valid_character_id(id) {
            return Err(format!("invalid character id: {id}"));
        }
        if !LEVEL_IDS.contains(&level.as_str()) {
            return Err(format!("invalid level: {level}"));
        }
    }

    let payload = if enabled {
        PersonaConfigFile {
            character,
            level: Some(level),
            enabled: true,
        }
    } else {
        PersonaConfigFile::default()
    };
    let mut json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("failed to encode persona.json: {e}"))?;
    json.push('\n');

    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let temp = path.with_extension(format!("json.tmp{}", std::process::id()));
    fs::write(&temp, json).map_err(|e| format!("failed to write {}: {e}", temp.display()))?;
    // Windows rename cannot replace an existing destination.
    let _ = fs::remove_file(&path);
    fs::rename(&temp, &path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("failed to replace {}: {e}", path.display())
    })?;

    Ok(read_state())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = concat!(
        "---\n",
        "id: noctis\n",
        "name: ノクティス\n",
        "source: \"ファイナルファンタジーXV\"\n",
        "level_light: 饒舌\n",
        "level_normal: 通常\n",
        "level_heavy: 無口\n",
        "---\n",
        "\n",
        "<!-- authoring note -->\n",
        "\n",
        "## 人物像\n",
        "\n",
        "俺はノクティス。\n",
        "\n",
        "## レベル: 通常\n",
        "\n",
        "そっけない。\n",
        "\n",
        "## レベル: 無口\n",
        "\n",
        "単語で返す。\n",
        "\n",
        "## 禁止事項\n",
        "\n",
        "- 引用しない\n",
    );

    fn sample_labels(meta: &BTreeMap<String, String>) -> BTreeMap<String, String> {
        let mut labels = BTreeMap::new();
        for level in LEVEL_IDS {
            labels.insert(
                level.to_string(),
                meta.get(&format!("level_{level}")).cloned().unwrap(),
            );
        }
        labels
    }

    #[test]
    fn frontmatter_is_flat_and_unquoted() {
        let (meta, body) = parse_frontmatter(SAMPLE);
        assert_eq!(meta.get("id").unwrap(), "noctis");
        assert_eq!(meta.get("source").unwrap(), "ファイナルファンタジーXV");
        assert!(body.starts_with("\n<!-- authoring note -->"));
    }

    #[test]
    fn frontmatter_absent_returns_whole_text() {
        let (meta, body) = parse_frontmatter("# hello\n");
        assert!(meta.is_empty());
        assert_eq!(body, "# hello\n");
    }

    #[test]
    fn crlf_files_parse_the_same() {
        let (meta, _) = parse_frontmatter(&SAMPLE.replace('\n', "\r\n"));
        assert_eq!(meta.get("id").unwrap(), "noctis");
    }

    #[test]
    fn level_sections_are_routed_by_label() {
        let (meta, body) = parse_frontmatter(SAMPLE);
        let (sections, levels) = split_sections(&body, &sample_labels(&meta));

        // Level headings never appear as ordinary sections.
        let headings: Vec<&str> = sections.iter().map(|s| s.heading.as_str()).collect();
        assert_eq!(headings, vec!["人物像", "禁止事項"]);

        assert_eq!(levels.get("normal").unwrap(), "そっけない。");
        assert_eq!(levels.get("heavy").unwrap(), "単語で返す。");
        // A level with no section is simply absent, not an error.
        assert!(!levels.contains_key("light"));
    }

    #[test]
    fn prose_before_the_first_heading_is_dropped() {
        let (_, body) = parse_frontmatter(SAMPLE);
        let (sections, _) = split_sections(&body, &BTreeMap::new());
        assert!(!sections.iter().any(|s| s.body.contains("authoring note")));
    }

    #[test]
    fn an_undeclared_level_heading_stays_a_section() {
        let (meta, body) = parse_frontmatter(SAMPLE);
        let mut labels = sample_labels(&meta);
        labels.insert("heavy".into(), "別名".into());
        let (sections, levels) = split_sections(&body, &labels);
        assert!(!levels.contains_key("heavy"));
        assert!(sections.iter().any(|s| s.heading == "レベル: 無口"));
    }

    #[test]
    fn an_english_character_file_works_the_same() {
        const EN: &str = concat!(
            "---\n",
            "id: holmes\n",
            "name: Holmes\n",
            "level_light: Discursive\n",
            "level_normal: Precise\n",
            "level_heavy: Clipped\n",
            "---\n\n",
            "## Who I am\n\n",
            "I am Holmes.\n\n",
            "## Level: Precise\n\n",
            "State the observation, then the inference.\n\n",
            "## Level: Clipped\n\n",
            "Inference only.\n",
        );

        let (meta, body) = parse_frontmatter(EN);
        let mut labels = BTreeMap::new();
        for level in LEVEL_IDS {
            labels.insert(
                level.to_string(),
                meta.get(&format!("level_{level}")).cloned().unwrap(),
            );
        }
        let (sections, levels) = split_sections(&body, &labels);

        // The English level headings are recognised, so they do not leak into
        // the ordinary sections — which is what would make all three levels
        // reach the model at once.
        let headings: Vec<&str> = sections.iter().map(|s| s.heading.as_str()).collect();
        assert_eq!(headings, vec!["Who I am"]);
        assert_eq!(
            levels.get("normal").unwrap(),
            "State the observation, then the inference."
        );
        assert_eq!(levels.get("heavy").unwrap(), "Inference only.");
    }

    #[test]
    fn a_full_width_colon_still_marks_a_level() {
        let mut labels = BTreeMap::new();
        labels.insert("normal".to_string(), "通常".to_string());
        let (sections, levels) = split_sections("## レベル：通常\n\nそっけない。", &labels);
        assert!(sections.is_empty());
        assert_eq!(levels.get("normal").unwrap(), "そっけない。");
    }

    #[test]
    fn character_ids_follow_the_plugin_rule() {
        assert!(is_valid_character_id("noctis"));
        assert!(is_valid_character_id("my-char_2"));
        assert!(!is_valid_character_id("_template"));
        assert!(!is_valid_character_id("-lead"));
        assert!(!is_valid_character_id("Noctis"));
        assert!(!is_valid_character_id(""));
        assert!(!is_valid_character_id(&"a".repeat(33)));
    }

    /// Builds `<root>/<rel>/character.md` with a minimal valid frontmatter.
    fn plant(root: &Path, rel: &str, id: &str, name: &str) {
        plant_ordered(root, rel, id, name, None);
    }

    fn plant_ordered(root: &Path, rel: &str, id: &str, name: &str, order: Option<i64>) {
        let dir = root.join(rel).join(id);
        fs::create_dir_all(&dir).unwrap();
        let order = order.map(|n| format!("order: {n}\n")).unwrap_or_default();
        fs::write(
            dir.join("character.md"),
            format!("---\nid: {id}\n{order}name: {name}\n---\n\n## 人物像\n\n俺は{name}。\n"),
        )
        .unwrap();
    }

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("workhub-persona-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_user_layer_shadows_the_bundled_one() {
        let root = temp_root("layers");
        plant(&root, "personas", "noctis", "私家版ノクト");
        plant(
            &root,
            "plugins/cache/workhub-marketplace/persona/0.2.0/characters",
            "noctis",
            "ノクティス",
        );
        plant(
            &root,
            "plugins/cache/workhub-marketplace/persona/0.2.0/characters",
            "ignis",
            "イグニス",
        );
        // Authoring scaffolding is not a selectable character.
        plant(
            &root,
            "plugins/cache/workhub-marketplace/persona/0.2.0/characters",
            "_template",
            "テンプレート",
        );

        let found = discover_characters_in(&root);
        let noctis = found.iter().find(|c| c.id == "noctis").unwrap();
        assert_eq!(noctis.origin, "user");
        assert_eq!(noctis.name, "私家版ノクト");
        assert_eq!(
            found.iter().find(|c| c.id == "ignis").unwrap().origin,
            "bundled"
        );
        assert!(!found.iter().any(|c| c.id.starts_with('_')));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_highest_cached_version_wins() {
        let root = temp_root("versions");
        let base = "plugins/cache/workhub-marketplace/persona";
        plant(&root, &format!("{base}/0.1.0/characters"), "ignis", "旧版");
        plant(&root, &format!("{base}/0.2.0/characters"), "ignis", "新版");

        let found = discover_characters_in(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "新版");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_declared_order_beats_the_name() {
        let root = temp_root("order");
        let cache = "plugins/cache/workhub-marketplace/persona/0.2.0/characters";
        // Names sort カタカナ before 漢字, so sorting by name alone would put
        // 原始人 last. The declared order is what must win.
        plant_ordered(&root, cache, "genshijin", "原始人", Some(1));
        plant_ordered(&root, cache, "noctis", "ノクティス", Some(2));
        plant_ordered(&root, cache, "lunafreya", "ルナフレーナ", Some(3));
        // No `order:` — sorts last regardless of its name.
        plant_ordered(&root, cache, "aaa", "アアア", None);

        let found = discover_characters_in(&root);
        let ids: Vec<&str> = found.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["genshijin", "noctis", "lunafreya", "aaa"]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn no_plugin_means_no_characters() {
        let root = temp_root("empty");
        assert!(discover_characters_in(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_frontmatter_id_that_does_not_match_its_folder_is_skipped() {
        let root = temp_root("mismatch");
        plant(&root, "personas", "ignis", "イグニス");
        // Copied without editing the id: `/persona ignis-copy` could never
        // select it, so the tab must not offer it either.
        let dir = root.join("personas").join("ignis-copy");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("character.md"),
            "---\nid: ignis\nname: 複製\n---\n",
        )
        .unwrap();

        let found = discover_characters_in(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "ignis");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_round_trips_through_serde() {
        let json = serde_json::to_string(&PersonaConfigFile {
            character: Some("ignis".into()),
            level: Some("heavy".into()),
            enabled: true,
        })
        .unwrap();
        let back: PersonaConfigFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.character.unwrap(), "ignis");
        assert_eq!(back.level.unwrap(), "heavy");
        assert!(back.enabled);
    }

    #[test]
    fn disabled_config_carries_no_character() {
        let json = serde_json::to_string(&PersonaConfigFile::default()).unwrap();
        assert_eq!(json, r#"{"enabled":false}"#);
    }
}
