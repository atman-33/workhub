//! Agent-harness integration: keeps the vault's harness configuration in sync
//! with the projects registered in the app — `.claude/project-context.json`
//! (read by the engineering plugin's hooks and the OpenCode mirror plugins)
//! and `opencode.json`'s directory permissions.

use crate::models::Project;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

const PROJECT_CONTEXT_RELATIVE: &str = ".claude/project-context.json";
const OPENCODE_CONFIG_RELATIVE: &str = "opencode.json";

/// Upserts the app's registered projects into the vault's
/// `.claude/project-context.json`.
///
/// Merge policy (the file is also hand-edited and consumed by AI tooling, so
/// the app must never destroy what it does not own):
/// - entries are keyed by normalized `path`; for each app project the entry's
///   `name`/`path` are set and every other key (`summary`,
///   `postToolFormatCommands`, ...) is preserved;
/// - entries present only in the JSON (registered by hand) are left untouched;
/// - top-level keys other than `projects` (e.g. `roleBasedDelegation`,
///   `openspecPath`) are preserved; a missing file starts from a minimal
///   default with `roleBasedDelegation: true`.
pub fn sync_project_context(vault: &Path, projects: &[Project]) -> Result<(), String> {
    let context_path = vault.join(PROJECT_CONTEXT_RELATIVE);

    let mut root: Map<String, Value> = match fs::read_to_string(&context_path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(map)) => map,
            // Malformed or non-object JSON: refuse to clobber a hand-edited
            // file we cannot merge into.
            Ok(_) => return Err(format!("{}: not a JSON object", context_path.display())),
            Err(e) => return Err(format!("{}: {}", context_path.display(), e)),
        },
        Err(_) => {
            let mut map = Map::new();
            map.insert("roleBasedDelegation".into(), Value::Bool(true));
            map
        }
    };

    let mut entries: Vec<Value> = match root.remove("projects") {
        Some(Value::Array(list)) => list,
        _ => Vec::new(),
    };

    for project in projects {
        let normalized = normalize_path(&project.path);
        if normalized.is_empty() {
            continue;
        }
        let existing = entries.iter_mut().find(|entry| {
            entry
                .get("path")
                .and_then(Value::as_str)
                .is_some_and(|p| normalize_path(p) == normalized)
        });
        match existing {
            Some(Value::Object(map)) => {
                map.insert("name".into(), Value::String(project.name.clone()));
                map.insert("path".into(), Value::String(normalized));
            }
            Some(_) => {} // non-object entry: leave it alone
            None => {
                entries.push(json!({ "name": project.name, "path": normalized }));
            }
        }
    }

    root.insert("projects".into(), Value::Array(entries));

    if let Some(parent) = context_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())?;
    fs::write(&context_path, body + "\n").map_err(|e| e.to_string())
}

/// Upserts an `"allow"` rule for every registered project into the vault's
/// `opencode.json` (`permission.external_directory`), so OpenCode sessions
/// started in the vault can reach the repositories without prompting.
///
/// Merge policy mirrors [`sync_project_context`] — the file is hand-edited and
/// carries settings the app knows nothing about:
/// - only the `<normalized-path>/**` keys are added; an existing key keeps its
///   current value, so a hand-written `"ask"` is never downgraded to `"allow"`;
/// - unrelated entries, `permission.bash`, and other top-level keys
///   (`watcher`, `mcp`, ...) are preserved;
/// - a missing file is a no-op: the vault template always ships one, and
///   generating a config from scratch would guess at settings we do not own;
/// - malformed or non-object JSON is refused rather than clobbered.
///
/// Unregistering a project does *not* remove its rule: a stale allow entry is
/// cheaper than deleting a rule the user may have meant to keep.
///
/// Note on key order: `serde_json` is built without `preserve_order`, so the
/// rewritten file comes back sorted alphabetically. OpenCode resolves
/// permissions by *last matching rule*, but the sort is harmless here — the
/// `permission.bash` catch-all `"*"` sorts first (ASCII 42), every key this
/// function writes is `"allow"`, and lexicographic order keeps a longer prefix
/// (`C:/repos/secret/**`) after the pattern it refines (`C:/repos/**`).
pub fn sync_opencode_permissions(vault: &Path, projects: &[Project]) -> Result<(), String> {
    let config_path = vault.join(OPENCODE_CONFIG_RELATIVE);

    let raw = match fs::read_to_string(&config_path) {
        Ok(raw) => raw,
        Err(_) => return Ok(()),
    };
    let mut root: Map<String, Value> = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(map)) => map,
        Ok(_) => return Err(format!("{}: not a JSON object", config_path.display())),
        Err(e) => return Err(format!("{}: {}", config_path.display(), e)),
    };

    let permission = root
        .entry("permission")
        .or_insert_with(|| Value::Object(Map::new()));
    let permission = permission
        .as_object_mut()
        .ok_or_else(|| format!("{}: `permission` is not an object", config_path.display()))?;

    let directories = permission
        .entry("external_directory")
        .or_insert_with(|| Value::Object(Map::new()));
    let directories = directories.as_object_mut().ok_or_else(|| {
        format!(
            "{}: `permission.external_directory` is not an object",
            config_path.display()
        )
    })?;

    for project in projects {
        let normalized = normalize_path(&project.path);
        if normalized.is_empty() {
            continue;
        }
        directories
            .entry(format!("{normalized}/**"))
            .or_insert_with(|| Value::String("allow".into()));
    }

    let body =
        serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())? + "\n";
    // Skip no-op writes: the vault auto-commits its own changes, and a rewrite
    // on every config save would fill its history with empty backups.
    if body == raw {
        return Ok(());
    }
    fs::write(&config_path, body).map_err(|e| e.to_string())
}

fn normalize_path(path: &str) -> String {
    path.trim().replace('\\', "/").trim_end_matches('/').into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, path: &str) -> Project {
        Project {
            path: path.into(),
            name: name.into(),
            tags: String::new(),
            favorite: false,
            notes: String::new(),
            last_opened: None,
        }
    }

    fn temp_vault(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-harness-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_context(vault: &Path) -> Value {
        let raw = fs::read_to_string(vault.join(PROJECT_CONTEXT_RELATIVE)).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    const OPENCODE_BASE: &str = r#"{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "~/**": "allow",
      "C:/repos/secret/**": "ask"
    },
    "bash": {
      "*": "allow",
      "git push*": "ask"
    }
  },
  "watcher": {
    "ignore": [
      ".tmp/**"
    ]
  }
}
"#;

    fn write_opencode(vault: &Path, body: &str) {
        fs::write(vault.join(OPENCODE_CONFIG_RELATIVE), body).unwrap();
    }

    fn read_opencode(vault: &Path) -> Value {
        let raw = fs::read_to_string(vault.join(OPENCODE_CONFIG_RELATIVE)).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn opencode_adds_rules_and_preserves_everything_else() {
        let vault = temp_vault("opencode-merge");
        write_opencode(&vault, OPENCODE_BASE);

        sync_opencode_permissions(
            &vault,
            &[
                project("alpha", r"C:\repos\alpha"),
                project("srms", "//wsl.localhost/Ubuntu/home/atman/repos/srms/"),
            ],
        )
        .unwrap();

        let cfg = read_opencode(&vault);
        let dirs = &cfg["permission"]["external_directory"];
        // New rules, with paths normalized.
        assert_eq!(dirs["C:/repos/alpha/**"], "allow");
        assert_eq!(
            dirs["//wsl.localhost/Ubuntu/home/atman/repos/srms/**"],
            "allow"
        );
        // Hand-written entries survive, including a deliberate `ask`.
        assert_eq!(dirs["~/**"], "allow");
        assert_eq!(dirs["C:/repos/secret/**"], "ask");
        assert_eq!(dirs.as_object().unwrap().len(), 4);
        // Sibling and top-level keys untouched.
        assert_eq!(cfg["permission"]["bash"]["*"], "allow");
        assert_eq!(cfg["permission"]["bash"]["git push*"], "ask");
        assert_eq!(cfg["watcher"]["ignore"][0], ".tmp/**");
        assert_eq!(cfg["$schema"], "https://opencode.ai/config.json");
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn opencode_never_downgrades_an_existing_rule() {
        let vault = temp_vault("opencode-ask");
        write_opencode(&vault, OPENCODE_BASE);
        // The project is registered but the user pinned it to `ask` by hand.
        sync_opencode_permissions(&vault, &[project("secret", "C:/repos/secret")]).unwrap();
        assert_eq!(
            read_opencode(&vault)["permission"]["external_directory"]["C:/repos/secret/**"],
            "ask"
        );
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn opencode_is_idempotent_and_skips_no_op_writes() {
        let vault = temp_vault("opencode-idem");
        write_opencode(&vault, OPENCODE_BASE);
        let projects = [project("alpha", "C:/repos/alpha")];

        sync_opencode_permissions(&vault, &projects).unwrap();
        let after_first = fs::read_to_string(vault.join(OPENCODE_CONFIG_RELATIVE)).unwrap();

        sync_opencode_permissions(&vault, &projects).unwrap();
        let after_second = fs::read_to_string(vault.join(OPENCODE_CONFIG_RELATIVE)).unwrap();

        assert_eq!(after_first, after_second);
        // No duplicate rules piled up.
        let dirs = read_opencode(&vault)["permission"]["external_directory"]
            .as_object()
            .unwrap()
            .len();
        assert_eq!(dirs, 3);
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn opencode_missing_file_is_a_no_op() {
        let vault = temp_vault("opencode-missing");
        sync_opencode_permissions(&vault, &[project("alpha", "C:/repos/alpha")]).unwrap();
        assert!(!vault.join(OPENCODE_CONFIG_RELATIVE).exists());
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn opencode_refuses_to_overwrite_malformed_file() {
        let vault = temp_vault("opencode-malformed");
        write_opencode(&vault, "not json");
        assert!(sync_opencode_permissions(&vault, &[project("a", "C:/repos/a")]).is_err());
        assert_eq!(
            fs::read_to_string(vault.join(OPENCODE_CONFIG_RELATIVE)).unwrap(),
            "not json"
        );

        // A `permission` key of the wrong shape is refused the same way.
        write_opencode(&vault, r#"{ "permission": "allow-everything" }"#);
        assert!(sync_opencode_permissions(&vault, &[project("a", "C:/repos/a")]).is_err());
        assert_eq!(
            fs::read_to_string(vault.join(OPENCODE_CONFIG_RELATIVE)).unwrap(),
            r#"{ "permission": "allow-everything" }"#
        );
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn creates_file_with_defaults_when_missing() {
        let vault = temp_vault("create");
        sync_project_context(&vault, &[project("alpha", "C:\\repos\\alpha")]).unwrap();
        let ctx = read_context(&vault);
        assert_eq!(ctx["roleBasedDelegation"], Value::Bool(true));
        assert_eq!(ctx["projects"][0]["name"], "alpha");
        assert_eq!(ctx["projects"][0]["path"], "C:/repos/alpha");
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn merge_preserves_extra_fields_and_manual_entries() {
        let vault = temp_vault("merge");
        fs::create_dir_all(vault.join(".claude")).unwrap();
        fs::write(
            vault.join(PROJECT_CONTEXT_RELATIVE),
            r#"{
  "roleBasedDelegation": false,
  "openspecPath": "C:/specs",
  "projects": [
    { "name": "old-name", "path": "C:/repos/alpha", "summary": "keep me",
      "postToolFormatCommands": ["npm run format"] },
    { "name": "manual", "path": "C:/repos/manual" }
  ]
}"#,
        )
        .unwrap();

        sync_project_context(
            &vault,
            &[
                project("alpha", "C:/repos/alpha/"),
                project("beta", "C:/repos/beta"),
            ],
        )
        .unwrap();

        let ctx = read_context(&vault);
        // Top-level keys preserved.
        assert_eq!(ctx["roleBasedDelegation"], Value::Bool(false));
        assert_eq!(ctx["openspecPath"], "C:/specs");
        let projects = ctx["projects"].as_array().unwrap();
        assert_eq!(projects.len(), 3);
        // Upserted: name refreshed, extra fields kept.
        assert_eq!(projects[0]["name"], "alpha");
        assert_eq!(projects[0]["summary"], "keep me");
        assert_eq!(projects[0]["postToolFormatCommands"][0], "npm run format");
        // Manual entry untouched, new project appended.
        assert_eq!(projects[1]["name"], "manual");
        assert_eq!(projects[2]["name"], "beta");
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn refuses_to_overwrite_malformed_file() {
        let vault = temp_vault("malformed");
        fs::create_dir_all(vault.join(".claude")).unwrap();
        fs::write(vault.join(PROJECT_CONTEXT_RELATIVE), "not json").unwrap();
        assert!(sync_project_context(&vault, &[project("a", "C:/repos/a")]).is_err());
        // Original content intact.
        assert_eq!(
            fs::read_to_string(vault.join(PROJECT_CONTEXT_RELATIVE)).unwrap(),
            "not json"
        );
        fs::remove_dir_all(&vault).unwrap();
    }
}
