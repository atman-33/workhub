---
name: create-manual-test-guide
description: Generate a self-contained HTML manual-testing guide for an implemented change — environment setup, a visual test-flow diagram, step-by-step scenarios with expected results, and interactive pass/fail checkboxes with a Markdown results export. Use when the user wants to verify an implementation by hand, asks "how do I test this", or wants a verification document for a feature/branch/PR.
allowed-tools: Read Glob Grep Write Bash(git *) Bash(start *) Bash(explorer.exe *)
---

# Create Manual Test Guide

Produce one self-contained HTML file that walks a human tester through
verifying an implementation: how to set up, what to do, what to expect, and a
checklist that exports its results back as Markdown.

## 1. Resolve the output directory

The output directory is per-installer configuration, resolved in this order:

1. `${CLAUDE_PLUGIN_ROOT}/config.json` → `outputDir` (shared across this plugin's skills)
2. `config.json` next to this SKILL.md → `outputDir` (skill-level override)
3. Neither exists → read [config.example.json](config.example.json) for the
   expected shape, ask the user for a real absolute path, then write it to the
   skill-level `config.json` (git-ignored) so the question is never asked again.

Honor `openAfterGenerate` (default `true`) from the same file.

## 2. Determine what to test

- The user named a feature, branch, PR, or commit range → use exactly that.
- Otherwise default to the current implementation:
  `git diff $(git merge-base main HEAD)...HEAD` on a feature branch, or
  `git diff HEAD` for uncommitted work. Confirm with the user if ambiguous.

## 3. Understand the behavior — derive scenarios from real code

- Read the changed files and trace user-facing entry points (UI routes, API
  endpoints, CLI commands, config flags) with Grep/Glob.
- Find out how the app is actually launched and configured (README, package
  scripts, docker-compose, `.env` examples) — setup instructions must be real
  commands, not guesses.
- Derive scenarios covering: the happy path per user-visible behavior, edge
  cases visible in the code (validation limits, empty states, permissions),
  error handling (invalid input, failures the code explicitly handles), and
  regression checks for adjacent behavior the change could have broken.
- If prerequisites exist you cannot verify (accounts, external services, seed
  data), list them explicitly as assumptions rather than inventing steps.

## 4. Generate the HTML guide

One self-contained `.html` file: inline `<style>`, `<script>`, and SVG — no
CDN, no external assets. Write prose in the language the user is conversing
in; keep commands, identifiers, and code as-is. Required sections, in order:

1. **Header** — repo, branch/scope, date, and the feature under test in one sentence.
2. **What was implemented** — a short overview so the tester knows what the
   change is supposed to do before testing it.
3. **Environment setup** — prerequisites, exact launch/build commands in
   copyable code blocks, required config/seed data, and how to reset state
   between runs if relevant.
4. **Test flow diagram** — inline SVG showing the order scenarios should run
   in and their dependencies (e.g. "create → edit → delete"), so the tester
   sees the whole session at a glance.
5. **Test scenarios** — one card/table per scenario: ID, purpose, precondition,
   numbered steps, expected result per step (side-by-side), and severity if it
   fails. Include the edge-case and regression scenarios from step 3.
6. **Results tracking (interactive)** — pass/fail/skip toggle and a free-text
   notes field per scenario, a progress bar for overall completion, and a
   **"Copy results as Markdown"** button that serializes scenario IDs,
   verdicts, and notes into a Markdown table ready to paste into a PR or chat.
   Persist state to `localStorage` so an accidental reload doesn't lose a
   half-finished session.

## 5. Save, open, report

- Filename: `<repo>-<branch-or-feature-slug>-manual-test-<yyyyMMdd-HHmm>.html`
  in the resolved output directory (create it if missing).
- If `openAfterGenerate`, open it: `start <path>` (fall back to
  `explorer.exe <path>`).
- Report the saved path, the number of scenarios by category
  (happy path / edge / error / regression), and any assumptions the tester
  must satisfy first.

## Failure modes

- No user-facing behavior in the scope (pure refactor, docs-only) → say so and
  ask whether a regression-only guide is still wanted instead of generating
  filler scenarios.
- Launch method genuinely undiscoverable from the repo → ask the user rather
  than fabricating setup commands.
- Not in a git repository and no feature named → stop and ask what to test.
