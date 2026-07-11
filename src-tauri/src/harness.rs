//! Agent-harness integration: keeps the vault's `.claude/project-context.json`
//! (read by the engineering plugin's hooks and the OpenCode mirror plugins)
//! in sync with the projects registered in the app.

use crate::models::Project;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

const PROJECT_CONTEXT_RELATIVE: &str = ".claude/project-context.json";

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
