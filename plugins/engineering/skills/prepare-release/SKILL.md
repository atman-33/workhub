---
name: prepare-release
description: Prepares a release by creating a release branch, bumping the version, guiding manual changelog curation from git history, and opening a PR to main. Use when the user wants to cut a release, prepare a release PR, ship a version, mentions "release prep", "prepare release", "cut release", or wants to manually write a changelog instead of auto-generating one.
---

# Prepare Release

Guided workflow to prepare a versioned release with a manually curated changelog.

## Quick start

1. Confirm the target repository and desired version number.
2. Create a release branch from the default branch.
3. Bump the version in all version-bearing files.
4. Review git history since the last tag and draft the changelog together with the user.
5. Commit and open a PR to the default branch.

## Workflow

### 1. Gather inputs

Ask the user (skip when already clear from context):
- **Target repository**: Which repo are we releasing?
- **Version**: Exact version number (e.g. `1.2.3`). Follow the project's existing convention.
- **Release type** (alternative): `patch`, `minor`, or `major`. If given, read the current version and compute the next one with semver rules instead of asking for an explicit version number.

Before proceeding, verify that no git tag exists for the target version:
```bash
git tag -l "v<VERSION>" "v*<VERSION>*"
```
Warn the user and stop if a matching tag is found.

### 2. Create the release branch

- Ensure the local default branch (`main` or `master`) is up to date from the remote.
- Create and switch to `release/v<VERSION>` (e.g. `release/v1.2.3`).
- If a `release/` prefix conflicts with the repository's convention, adopt its existing pattern instead.

### 3. Bump the version

Identify every version-bearing file in the repository. Common patterns:

| Ecosystem   | Files                                                |
|------------|------------------------------------------------------|
| Node.js    | `package.json` (and `package-lock.json` via `npm install`) |
| Rust       | `Cargo.toml`                                         |
| Python     | `pyproject.toml`, `setup.cfg`, `__init__.py`         |
| Java/Maven | `pom.xml`                                            |
| C#         | `*.csproj`                                           |
| Generic    | Any file with a `version` field, `VERSION` file, or version constant |

Apply the version string to every file found. After bumping:
- Regenerate lock-files (`npm install`, `cargo generate-lockfile`, etc.).
- Run the project's `default-checks` or `npm run compile` equivalent from the active project context.
- Confirm the version is consistent across all files.

### 4. Curate the changelog

1. Locate the previous release tag:
   ```bash
   git describe --tags --abbrev=0 2>/dev/null
   ```
   If no previous tag exists, treat this as the first release.

2. Show the commit summary to the user:
   ```bash
   git log <previous-tag>..HEAD --oneline --no-merges
   ```

3. If `CHANGELOG.md` exists, update it following [Keep a Changelog](https://keepachangelog.com/) conventions:
   - Insert `## [VERSION] - YYYY-MM-DD` above the most recent version entry.
   - Categorize changes under `### Added`, `### Changed`, `### Fixed`, `### Removed`.
   - If an `[Unreleased]` section exists, fold its content into the new version section.

   If no `CHANGELOG.md` exists, ask the user whether to create one or to describe the release notes in the PR body only.

4. Present the drafted changelog to the user. **Do not commit until the user confirms the changelog content.**

### 5. Commit and create PR

- Commit message: `chore(release): prepare v<VERSION>`
- Push the release branch.
- Create a PR targeting the default branch with:
  - Title: `chore(release): v<VERSION>`
  - Body: The curated changelog section for this version.
  - Do not include issue-closing keywords unless the user explicitly requests it.

### 6. Report

Summarize what was prepared:
- Branch name and PR URL
- Version bumped in which files
- Changelog section drafted

Remind the user:
- The PR is not merged — they must review and merge it themselves.
- After merge, the release pipeline (tag creation, build, publish) is typically triggered by the project's CI/CD workflow (e.g. `release.yml`, `release-only.yml`, or a tag-push hook). **This skill does not trigger the pipeline.**

## Guardrails

- Never push tags. Tag creation belongs to the CI/CD pipeline.
- Never merge the PR. The user owns the final review and merge.
- Never modify version files outside the target repository.
- If a matching tag already exists for the target version, warn the user and stop.
- Follow the target repository's conventions (branch prefix, commit format, changelog style) over the defaults listed here.
