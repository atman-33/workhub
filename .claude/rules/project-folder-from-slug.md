---
paths:
  - "src-tauri/src/vault_note.rs"
  - "src-tauri/src/vault_project.rs"
  - "src-tauri/src/schedule.rs"
  - "src-tauri/src/mindmap.rs"
  - "src-tauri/src/commands.rs"
  - "src/components/schedule/**"
  - "src/components/mindmap/**"
  - "src/components/projects/**"
  - "src/lib/vault-project.ts"
  - "src/lib/api.ts"
---

# A project folder is `NNNN-<slug>`, never `projects/<slug>/`

A vault project's folder is `projects/NNNN-<slug>/` — a four-digit sort
number, a hyphen, then the slug. The slug alone is **not** a folder name, so
code must never build `${vaultPath}/projects/${slug}/...` (or the archived
equivalent) by string concatenation for a path used in file I/O. That guess
is wrong for every numbered project, and when it feeds `create_dir_all` it
silently creates a second, empty, wrong project folder next to the real one
(T-0379: this exact bug in the Schedule/Mindmap export).

The only correct ways to resolve a slug to its real folder:

- **Rust**: `vault_note::resolve_project_dir(&vault_note::projects_dir(vault), slug)`
  (or `archive_projects_dir` when archived projects are in scope). It globs
  `projects/*-<slug>/`, handles the unnumbered-folder case, and errors on an
  ambiguous slug rather than picking one silently.
- **Frontend**: call the `resolve_project_dir` Tauri command (`api.resolveProjectDir`)
  to get the real path before building anything under it — never assume the
  slug is the folder name.

Display-only text (a confirmation dialog describing where a folder *would*
move to, help copy, etc.) is not file I/O and is not what this rule is about —
`src/components/projects/projects-view.tsx`'s archive/restore copy is a
deliberate example of that exception.

When a generated file write (an export, a scaffold) lands under a project's
default vault path, do not let `create_dir_all` invent the project folder
itself: resolve the slug first and fail the write if it does not resolve
(see `vault_note::ensure_export_dir`, used by `schedule::export_html` and
`mindmap::export_file`/`export_binary`). Creating a subfolder *inside* an
already-existing project folder (e.g. `attachments/`) is fine; creating the
project folder is not.
