---
paths:
  - "src-tauri/src/models.rs"
  - "src-tauri/src/storage.rs"
  - "src-tauri/src/vault_settings.rs"
  - "src/types.ts"
  - "src/components/settings-dialog.tsx"
---

# Where a new setting goes

Workhub settings live in two places, and adding one means deciding which
(T-0206). Getting it wrong is not a style issue: a machine path written to
the vault breaks the user's *other* PC after a pull.

| Store | File | For |
|---|---|---|
| machine-local | `~/.workhub/config.json` | everything by default |
| vault-scoped | `<vault>/.workhub/settings.json` | settings that describe the vault, git-tracked with it |

Both are still one `Settings` struct in `models.rs`. `storage::load()`
overlays the vault file on top of the local one, and `storage::save()` writes
both — so no call site has to know about the split. The whitelist that
decides which keys are vault-scoped is `VAULT_SCOPED` in
`src-tauri/src/vault_settings.rs`, and it is the **only** place the split is
declared.

## Choosing

Ask what the value describes.

- **This machine** → local. Filesystem paths, command templates, executable
  locations, hotkeys, window geometry, audio/input devices, anything naming
  hardware or an installed program.
- **Runtime state / history** → local. Selection, sort order, "last opened",
  last-run timestamps, session ids. It is a log, not a preference.
- **The vault and how agents work in it** → vault-scoped. Prompt text, task
  language, agent/model preferences for vault features, recurring-task
  definitions, tidy policy. A user who clones the vault on a second PC should
  get these back without re-entering them.

Two traps:

- A setting can be *mostly* portable with a machine-local part. `tidy` is the
  worked example: its policy (`interval_hours`, `stale_days`, …) is
  vault-scoped, while `anchor`, `last_run` and `last_session_id` are not.
  That is what `TIDY_SCOPED` is for — carry the object, filter the fields.
  Merge such an object field by field; never replace it wholesale.
- **A flag any agent-side script reads directly must stay local**, or be
  taught the overlay first. `secretary_enabled` and `memory_*` are read
  straight out of `~/.workhub/config.json` by the Claude Code hooks
  (`plugins/workhub/hooks/lib.mjs`), the memory engine
  (`plugins/workhub/memory-engine/lib/paths.mjs`) and two OpenCode plugins
  (`vault-template/.opencode/plugins/`). Moving them to the vault without
  updating all four makes the app and the agents disagree silently.

## Adding one

1. Add the field to `Settings` in `src-tauri/src/models.rs` with a
   `#[serde(default …)]` and a doc comment saying *why* it is where it is.
2. Mirror it in `src/types.ts` — `settings_field_parity_with_types_ts` fails
   the build if the two drift.
3. Vault-scoped? Add the key to `VAULT_SCOPED` (or the relevant sub-key list)
   in `vault_settings.rs` — nothing else — and mark its control in
   `settings-dialog.tsx` with `<VaultScopedBadge />`, so the user can see
   which settings follow the vault.
4. Never read `~/.workhub/config.json` directly from Rust: go through
   `storage::load()`, which is what applies the overlay.
