---
name: create-release-notes
description: Write user-facing release notes from the Conventional Commits history between two refs — grouped by impact, in plain language, with internal-only changes filtered out. Use when the user wants release notes, an announcement of what's new in a version, or a user-readable summary of changes since the last release (distinct from a developer changelog).
allowed-tools: Read Glob Grep Write Bash(git *) Bash(gh *)
---

# Create Release Notes

Release notes are for **users of the software**, not its developers — that
distinction drives every step. A developer changelog (exhaustive, technical,
commit-shaped) is `prepare-release`'s job in the engineering plugin; this
skill produces the announcement.

## Steps

1. **Determine the range.** Default: latest tag → `HEAD`
   (`git describe --tags --abbrev=0`). The user's explicit range or tag pair
   overrides. If no tag exists, ask what "since the last release" means here.

2. **Collect the changes.** `git log <from>..<to> --pretty='%h %s%n%b'`.
   Where commits are thin, enrich from merged PR titles/bodies
   (`gh pr list --state merged --search <sha>` — best-effort; skip silently
   if `gh` is unavailable).

3. **Filter for user visibility.** Keep what a user can see or feel:
   features, fixes to behavior, performance, breaking changes, deprecations.
   Drop refactors, CI, tests, docs-tooling, dependency bumps — unless one has
   a user-visible consequence (e.g. a dependency bump that fixes a
   vulnerability), in which case describe the consequence, not the bump.
   - Completion criterion: every commit in the range is either represented in
     a note or consciously dropped as internal — not silently lost.

4. **Write the notes.** In the language the release audience reads
   (ask if unclear). Rules:
   - Lead with the highlights: 1–3 sentences on what this release is about.
   - Sections in impact order: **Breaking changes** (with migration steps) →
     **New** → **Improved** → **Fixed**.
   - Each item names the user benefit, not the implementation ("Search now
     matches partial words", not "Refactored tokenizer").
   - No commit hashes or internal ticket ids in the body; keep a collapsed
     "full changelog" link/line at the end instead.

5. **Deliver.** Show the draft in chat. If the user wants a file, write where
   they say (convention: `docs/releases/<version>.md`); if they want it on a
   GitHub release, `gh release create <tag> --notes-file <file>` (or
   `gh release edit`) — confirm before creating anything public.

## Failure modes

- Range is empty → report "no changes between <from> and <to>"; don't pad.
- Commits are not Conventional and too terse to classify → group by best
  guess, and flag the items you classified with low confidence instead of
  presenting them confidently.
