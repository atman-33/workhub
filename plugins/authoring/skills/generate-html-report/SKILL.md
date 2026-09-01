---
name: generate-html-report
description: Generate a rich, self-contained HTML document instead of a long Markdown file — for specs & plans, PR/code-review explainers, design mockups & prototypes, research/status reports, or throwaway editing UIs. Use when the user asks to write a "report", wants a PR or piece of code explained visually, wants to compare design options, needs a research or status writeup, wants a diagram/flowchart, or when a Markdown plan/spec is getting too long to read comfortably.
allowed-tools: Write Read Glob Grep Bash(start *) Bash(explorer.exe *)
---

# Generate HTML Report

## Role

You are producing a rich, self-contained HTML document in place of a long Markdown file, because HTML can express tables, CSS, SVG diagrams, and interactivity that Markdown cannot, and people actually read it.

## The 100-line rule

Default to HTML whenever a Markdown document would credibly cross ~100 lines, or needs a diagram, table, side-by-side comparison, color-coding, or interaction. Below that, plain Markdown is still fine — don't reach for HTML for a quick note.

## 1. Pick the mode

Each mode shapes the content differently; read its detail in [MODES.md](MODES.md) before writing.

- **Spec / plan** — brainstorming multiple options, mockups, an implementation plan.
- **Code review / PR explainer** — annotated diffs, flowcharts of changed logic, severity-coded findings.
- **Design / prototype** — mockup comparisons, tunable sliders/knobs for animations or components.
- **Research / status report** — synthesis across code, git history, connected MCPs, or the web into a readable writeup.
- **Editing interface** — a throwaway single-purpose UI (drag-sort, form editor, side-by-side tuner) ending in a "copy as …" export.

If nothing fits cleanly, default to the Research / status report shape.

## 2. Gather the content

Read whatever the mode needs before writing a line of HTML: source files, `git log`/`git diff`, MCPs already connected in this session (Slack, Linear, etc.), or the web. Never fabricate data, diagrams, or diffs you haven't actually read.

## 3. Write one self-contained file

- Single `.html` file: inline `<style>` and `<script>`, no build step, no external CDN unless the user asks — this is what makes it a one-file upload someone else can just open.
- Use real HTML structure for the content: `<table>` for tabular data, inline SVG for diagrams/flowcharts, `<script>` for interactions, CSS for layout and color coding.
- If the project already has a design-system HTML file, read it first and match its look; otherwise keep styling clean and readable.
- For an editing interface, always end with an export control (a "copy as JSON / Markdown / diff" button) that turns the user's in-browser edits back into something pasteable into a prompt.

## 4. Finish

- Save the file (ask where if the mode/user hasn't implied a path) and open it: `start <path>` (fall back to `explorer.exe <path>` if `start` errors).
- Report the path, the mode chosen, and one line on how to share it (open locally, or upload it somewhere to get a link).

## Tradeoffs to keep in mind

- HTML takes noticeably longer to generate than Markdown — worth it past the 100-line rule, not for a quick note.
- HTML diffs are noisy in version control; don't replace a Markdown file that's actively reviewed as text (e.g. a spec living in a PR review flow) unless the user wants that tradeoff.
- Token cost is higher than Markdown but rarely the real bottleneck with large context windows — don't let it stop you from using the richer format when the content warrants it.
