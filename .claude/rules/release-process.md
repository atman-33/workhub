---
description: Release process and asset-naming contract for workhub
paths:
  - "src-tauri/Cargo.toml"
  - "CHANGELOG.md"
  - ".github/workflows/**"
  - "src-tauri/src/update.rs"
---

# Release process

`src-tauri/Cargo.toml` `version` is the single source of truth
(`tauri.conf.json` deliberately has no version field so it falls back to
Cargo.toml; `package.json` deliberately has no `version` field either — the
in-app version display reads `CARGO_PKG_VERSION` via the `app_version`
command). Releases are cut by pushing a `vX.Y.Z` tag;
`.github/workflows/release.yml` builds, packages, and publishes the GitHub
Release automatically.

## Steps to cut a release

1. Ensure `main` is green (CI passing) and the working tree is clean.
2. Bump `version` in `src-tauri/Cargo.toml` (semver: breaking → major,
   feature → minor, fix → patch).
3. Add a section to `CHANGELOG.md` for the new version.
4. Commit as `chore(release): vX.Y.Z`.
5. Tag exactly `vX.Y.Z` (must match Cargo.toml — the workflow fails otherwise)
   and push: `git push origin main --tags`.
6. Verify the Release appeared with all three assets (see contract below).

## Hard invariants — breaking these bricks installed copies

- **Tag format is `vX.Y.Z`** and must equal the Cargo.toml version.
- **Every release must carry a bare `workhub.exe` asset with exactly that
  name.** `src-tauri/src/update.rs` finds the download URL by matching the
  asset name `workhub.exe`; the README install command uses
  `releases/latest/download/workhub.exe`. Renaming or dropping this asset
  silently disables self-update for every installed copy.
- The zip asset is `workhub-windows-x86_64.zip` (referenced by README).
- Never create or edit GitHub Releases by hand; never re-tag a published
  version.
