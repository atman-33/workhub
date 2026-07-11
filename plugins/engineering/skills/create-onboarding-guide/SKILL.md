---
name: create-onboarding-guide
description: Generate a self-contained HTML onboarding tour of a repository — architecture diagram, directory map, key flow walkthroughs, and a recommended reading order — for new team members. Use when the user wants onboarding material, asks for a codebase overview/architecture tour, or wants to explain a repo to someone new.
allowed-tools: Read Glob Grep Write Bash(git *) Bash(start *) Bash(explorer.exe *)
---

# Create Onboarding Guide

Produce one self-contained HTML file that takes a newcomer from zero to
"I know where things live and how the main flows run" in one sitting.

## 1. Resolve the output directory

Same per-installer configuration as this plugin's other guide skills:

1. `${CLAUDE_PLUGIN_ROOT}/config.json` → `outputDir` (shared across this plugin's skills)
2. `config.json` next to this SKILL.md → `outputDir` (skill-level override)
3. Neither exists → read [config.example.json](config.example.json) for the
   shape, ask the user for a real absolute path, then write the skill-level
   `config.json` (git-ignored).

Honor `openAfterGenerate` (default `true`).

## 2. Confirm the target

Confirm which repository (and, for a monorepo, which package/area) the guide
covers, and who it's for (new engineer on the team vs. external contributor) —
that decides how much project-specific context to assume. Default: the whole
current repo, for a new team engineer.

## 3. Explore the codebase — the guide is only as true as this step

- Map the layout: top-level directories, build/config files, README/docs.
- Identify the architecture: layers/modules and the dependencies between them,
  traced from real imports/references (Grep), not directory names alone.
- Trace 2–3 **key flows** end-to-end (e.g. a request from route → handler →
  service → persistence; app startup; the primary user action). Record actual
  file:line hops.
- Note conventions a newcomer must know: naming patterns, where tests live,
  how config/env is loaded, codegen or other "don't edit by hand" areas.
- Completion criterion: every module in the architecture diagram and every hop
  in a flow walkthrough is backed by a file you actually read.

## 4. Generate the HTML guide

One self-contained `.html` file: inline `<style>`, `<script>`, SVG — no CDN.
Prose in the user's conversation language; identifiers and paths as-is.
Sections, in order:

1. **Header** — repo, purpose in one sentence, tech stack, date generated.
2. **Architecture diagram** — inline SVG of layers/modules with dependency
   arrows; a legend; each node listing its main directory.
3. **Directory map** — collapsible tree of the significant directories, each
   with a one-line role ("what lives here / when you'd touch it"). Skip
   vendored/generated noise.
4. **Key flow walkthroughs** — one per traced flow: a numbered sequence
   diagram (SVG) plus a step table of file → function → what happens.
5. **Conventions & gotchas** — the step-3 conventions list, including
   anything marked "don't edit by hand".
6. **Recommended reading order** — an ordered path of ~5–10 files to read
   first, each with one line on why it's on the path.
7. **Getting started** — real setup/build/test commands taken from the repo's
   README or scripts, in copyable code blocks.

Interactivity: sticky table of contents, collapsible directory tree and flow
sections.

## 5. Save, open, report

- Filename: `<repo>-onboarding-<yyyyMMdd>.html` in the resolved output
  directory (create it if missing).
- If `openAfterGenerate`, open it: `start <path>` (fall back to `explorer.exe <path>`).
- Report the saved path and which flows the guide walks through.

## Failure modes

- Repo too large to trace honestly in one pass → scope the guide to the
  agreed area from step 2 and say so in the header, rather than diluting the
  whole repo into vagueness.
- No obvious key flows (pure library) → walk the public API surface and one
  representative usage instead.
