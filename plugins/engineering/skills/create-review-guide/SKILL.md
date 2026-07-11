---
name: create-review-guide
description: Generate a self-contained HTML code-review guide for the current changes — big-picture overview, architecture diagram of affected modules, a file/class responsibility map, and an annotated change walkthrough — so a reviewer can grasp the whole implementation before diving into the diff. Use when the user wants review material for a branch/PR, asks to "explain the changes for review", or wants a visual summary of what was implemented where.
allowed-tools: Read Glob Grep Write Bash(git *) Bash(start *) Bash(explorer.exe *)
---

# Create Review Guide

Produce one self-contained HTML file that lets a reviewer understand the
implementation top-down — purpose, architecture, where each piece lives, and
what changed — before (and while) reading the diff.

## 1. Resolve the output directory

The output directory is per-installer configuration, resolved in this order:

1. `${CLAUDE_PLUGIN_ROOT}/config.json` → `outputDir` (shared across this plugin's skills)
2. `config.json` next to this SKILL.md → `outputDir` (skill-level override)
3. Neither exists → read [config.example.json](config.example.json) for the
   expected shape, ask the user for a real absolute path, then write it to the
   skill-level `config.json` (git-ignored) so the question is never asked again.

Honor `openAfterGenerate` (default `true`) from the same file.

## 2. Determine the review scope

Pick the first that applies; confirm with the user only if ambiguous:

- The user named a branch, PR, or commit range → use exactly that
  (`git diff <base>...<head>`).
- The working tree is dirty → uncommitted changes (`git diff HEAD`, plus
  `git diff --staged` if partially staged).
- On a feature branch → `git diff $(git merge-base main HEAD)...HEAD` and
  `git log` for that range. (Fall back to `master`/`develop` if `main` is absent.)
- On the default branch with a clean tree → ask the user what to review.

## 3. Gather real content — never fabricate

- Run `git log --oneline` for the range and `git diff --stat` for the shape of the change.
- Read every changed file in full — not just hunks — so responsibilities and
  class/function roles are described accurately.
- Trace the key entry points and callers of changed code (Grep/Glob) so the
  architecture diagram reflects actual dependencies, not guesses.
- Note anything you could not verify; mark it "unverified" in the guide rather
  than inventing it.

## 4. Generate the HTML guide

One self-contained `.html` file: inline `<style>`, `<script>`, and SVG — no
CDN, no external assets. Write prose in the language the user is conversing
in; keep identifiers, paths, and code as-is. Required sections, in order:

1. **Header** — repo, branch/range, date, commit list, `--stat` summary
   (files / insertions / deletions).
2. **Overview** — what was implemented and why, in a few paragraphs a reviewer
   can read in one minute.
3. **Architecture diagram** — inline SVG of the affected modules/layers and the
   data/control flow between them. Highlight changed nodes (e.g. colored
   border), dim unchanged context nodes, and add a legend
   (added / modified / deleted / unchanged).
4. **File & responsibility map** — a table: file → class/function → its role →
   change type (added / modified / deleted), each row linking to its
   walkthrough entry below.
5. **Change walkthrough** — per file, in the recommended reading order (state
   that order explicitly): what changed, why, and an annotated diff excerpt of
   the important hunks (green added / red removed lines, with inline notes for
   non-obvious decisions). Collapsible per file (`<details>` or JS toggle).
6. **Reviewer checklist** — concrete points worth verifying: risk areas, edge
   cases, behavioral changes, migration/config impacts, and any "unverified"
   items from step 3.

Interactivity to include: collapsible walkthrough sections, a change-type
filter for the map table, and a sticky table of contents. Keep the styling
clean and readable; light/dark is optional.

## 5. Save, open, report

- Filename: `<repo>-<branch-slug>-review-<yyyyMMdd-HHmm>.html` in the resolved
  output directory (create it if missing).
- If `openAfterGenerate`, open it: `start <path>` (fall back to
  `explorer.exe <path>`).
- Report the saved path, the review scope used, and a 2–3 line summary of what
  the guide covers.

## Failure modes

- No changes found in the chosen scope → stop and report; do not generate an empty guide.
- Not in a git repository → stop and report.
- Very large diffs (> ~50 files) → summarize low-impact files (generated code,
  lockfiles, renames) in a single collapsed table instead of full walkthrough
  entries, and say so in the guide.
