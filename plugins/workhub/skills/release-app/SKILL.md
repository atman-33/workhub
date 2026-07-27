---
name: release-app
description: Cut a workhub release — bump the app version, write the changelog entry, commit to main, tag `vX.Y.Z`, push, and verify the GitHub Release published with every required asset. Use when the user wants to release or ship the workhub app, tag a version, or publish a build.
argument-hint: "[version]"
allowed-tools: Read Edit Glob Grep Bash(git *) Bash(gh *)
---

# release-app — Publish a workhub release

A workhub release is a **tag push**, not a PR: pushing `vX.Y.Z` to `main` is
what builds and publishes the GitHub Release. That makes the push the point of
no return — a published version is never re-tagged — so this skill front-loads
every check and stops for approval before it.

The release **contract** (tag format, required assets, hard invariants) is not
restated here. It lives in the repository, and step 1 reads it.

## 1. Read the contract

Read `.claude/rules/release-process.md` in the workhub repository. It is the
authority for the tag format, the asset names the release must carry, and the
invariants that must never break. Everything below defers to it.

Completion criterion: you can name the required tag format, every required
release asset, and what breaks if one is renamed.

## 2. Get onto a clean, current `main`

```bash
git status --short
git checkout main
git pull --ff-only origin main
```

An unclean tree is a stop, not a thing to tidy: show the user what is there and
let them decide. Never stash, reset, or discard on their behalf.

Completion criterion: `git status --short` is empty and local `main` equals
`origin/main`.

## 3. Check that `main` is green

```bash
gh run list --branch main --limit 1
```

Anything other than a completed success is a stop — report which run and why.
A red `main` that gets tagged burns a version number.

## 4. Decide what is being released

```bash
git describe --tags --abbrev=0          # last released version
git log <last-tag>..HEAD --oneline --no-merges
```

Read the current `version` from `src-tauri/Cargo.toml` and compare it with the
last tag. Two states are normal:

- **Version already bumped, tag missing.** A previous run prepared the version
  and stopped. Reuse it — unless commits landed after the changelog entry was
  written, in which case those commits still need representing.
- **Version equals the last tag.** A fresh bump is needed. Propose it from what
  the commits actually are: breaking → major, feature → minor, fix → patch.

Then check the version is not already released:

```bash
git tag -l "v<VERSION>"
```

A hit is a hard stop. Never re-tag a published version.

Completion criterion (exhaustive): every commit between the last tag and `HEAD`
is either represented in the changelog entry for the version about to be
tagged, or you can say why it is deliberately not (internal-only work with no
user-visible consequence).

## 5. Bump the version and write the changelog

Skip whatever step 4 found already done.

- Set `version` in `src-tauri/Cargo.toml`. It is the single source of truth —
  the tag is verified against it, and the app reads it at runtime.
- Add a section to `CHANGELOG.md` above the most recent one.

Match the existing entries' voice: one bullet per user-visible change, in prose,
naming the task id, saying what changed **and why it was worth doing** — not a
commit list. Read the previous two sections before writing.

## 6. Stop for approval

Present, in one message:

- the version to be released,
- the changelog section as drafted,
- and plainly: this commits directly to `main`, creates the tag `vX.Y.Z`, and
  pushes both to `origin`.

Wait for the user's explicit approval. Do not continue on silence, on a
question, or on anything short of a yes. This is the only gate before the
release becomes public and permanent.

## 7. Commit, tag, push

```bash
git commit -am "chore(release): v<VERSION>"
git tag v<VERSION>
git push origin main --tags
```

## 8. Verify the release published

Wait for the tag-triggered workflow to finish, then read the release back:

```bash
gh run watch
gh release view v<VERSION> --json assets,url
```

Completion criterion: **every** asset named in `release-process.md` is present
under exactly that name. A missing or renamed asset is a release failure, not a
detail — report it rather than closing out. Do not fix it by uploading or
editing the release by hand; the workflow owns the release.

## 9. Report

Give the user the release URL and the asset list.

## Guardrails

- Never push without the step 6 approval.
- Never re-tag or re-push a version that already has a tag.
- Never create or edit a GitHub Release by hand.
- Never proceed on a red `main` or an unclean working tree.
- Never discard the user's uncommitted work to get a clean tree.
