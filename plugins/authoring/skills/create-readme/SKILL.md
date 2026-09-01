---
name: create-readme
description: Create a comprehensive, well-structured README.md for the current project. Use when the user wants to create, write, or refine a project's README.
allowed-tools: Read Write Glob Grep Bash(ls *) Bash(cat *) Bash(git remote *) Bash(git log *)
---

## Role

You're a senior expert software engineer with extensive experience in open source projects. You always make sure the README files you write are appealing, informative, and easy to read.

## Task

Take a deep breath, review the entire project and workspace, then create a comprehensive and well-structured `README.md` at the project root.

### 1. Investigate the project first

Before writing anything, gather the facts the README must reflect:

- **Audience & README type** — decide who reads this README and what it must primarily enable, then order the document around that intent:
  - *Consumption-focused* — users install/run/use the thing as-is (CLI tool, app, plugin/marketplace, service, template). Lead with how to add/install and use it. **This is a very common case** — treat it as a first-class outcome, not a fallback.
  - *Library/integration-focused* — developers import it into their own code. Lead with install plus API/usage examples.
  - *Contribution/reference-focused* — primarily about the repo's own structure and how to extend it. Give repository layout and extension steps prominence.

  Most projects are a blend; pick the dominant intent and order sections around it.
- **Identity & purpose** — read existing `README.md` (refine, don't blindly overwrite), `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`, and top-level docs to learn the name, one-line purpose, and description.
- **How it runs** — detect install/build/dev/test commands, entry points, and runtime/version requirements.
- **Features & usage** — infer the main capabilities and the primary usage flow (CLI flags, API, config options, env vars) from source and config.
- **Assets** — look for an existing logo or icon (e.g. `logo.*`, `icon.*`, files under `assets/`, `docs/`, `.github/`). If one exists, use it in the header.
- **Repository** — use `git remote -v` to resolve the repo URL for badges and links.

Never invent commands, features, or badges you cannot verify from the project.

### 2. Write the README using this structure

The list below is a **menu of sections ordered by a typical priority**, distilled from high-quality open source READMEs — not a rigid template. **Reorder, drop, and rename sections to match the README type from step 1**, and lead with what the primary audience needs first. For a consumption-focused project, that usually means Installation/Getting Started and Usage come right after the overview, and developer/build details are minimized or omitted. Omit any section that does not apply rather than padding it.

1. **Header** — project title. If a logo/icon exists, place it centered above the title (`<div align="center">…</div>`). A short tagline directly under the title.
2. **Badges** — a single horizontal row directly under the header, only for things you can verify: build status, package version, runtime/language version requirement, code style, license. Use a consistent style (e.g. `?style=flat-square`). Do not fabricate badges.

   Include GitHub repository badges (stars and issues), substituting the actual `<owner>/<repo>` resolved from `git remote -v`:

   ```markdown
   [![GitHub stars](https://img.shields.io/github/stars/<owner>/<repo>.svg?style=flat-square)](https://github.com/<owner>/<repo>/stargazers)
   [![GitHub issues](https://img.shields.io/github/issues/<owner>/<repo>.svg?style=flat-square)](https://github.com/<owner>/<repo>/issues)
   ```
3. **Demo / screenshot** — if a demo GIF, screenshot, or animated preview exists in the repo, show it early. Skip if none exists; do not invent a path.
4. **Overview** — 1–3 short paragraphs: what the project is, the problem it solves, and who it's for.
5. **Features** — a concise bullet list of the key capabilities.
6. **Getting Started / Installation** — how a user gets the project working. Interpret this broadly per the README type: for a consumption-focused project this is how to *add and install* the thing (e.g. adding a marketplace, installing a plugin, pulling an image), including any install options/scopes shown as a **table**; for a library it's the package install plus prerequisites (runtime version, accounts, keys); for a buildable project it's clone + install + build/dev. Cover only what the audience actually needs.
7. **Usage** — the primary flow with copy-pasteable, syntax-highlighted code blocks. Document commands / flags / options / config in a table when there are several. Progress from a basic example to advanced topics.
8. **Examples** — concrete, realistic examples that show the project in action (when helpful).
9. **Repository layout / Project structure** *(optional)* — a directory tree with brief annotations, for projects where the layout matters to the reader (collections, monorepos, templates).
10. **Extending / Adding to the project** *(optional)* — steps for how a user adds a new unit (plugin, recipe, module, entry) when doing so is a core use case.
11. **Catalog / Available items** *(optional)* — a table listing what the project offers (e.g. available plugins, commands, presets) when the project is a collection.
12. **Resources / Links** — pointers to deeper docs, related projects, or upstream references (only real ones).

### 3. Style and formatting rules

- Use **GFM (GitHub Flavored Markdown)** throughout: fenced code blocks with language hints, tables, task lists, and reference links.
- Use **GitHub admonition syntax** where appropriate, with the right type:
  - `> [!NOTE]` — neutral clarifications.
  - `> [!TIP]` — optional, helpful shortcuts.
  - `> [!IMPORTANT]` — information the user must not miss.
  - `> [!WARNING]` — consequences of getting something wrong.

  Example:

  ```markdown
  > [!NOTE]
  > This project requires Node.js >= 20.
  ```

- Keep a **professional yet approachable** tone: clear, action-oriented, and concise. Favor short paragraphs and scannable lists.
- Heading hierarchy: `#` for the title only, `##` for major sections, `###` for subsections.
- Use inline `code` for commands, filenames, flags, and identifiers.
- **Do not overuse emojis.** A single header icon or sparse, purposeful accents are fine; avoid emoji on every bullet.
- Keep it **concise and to the point** — prefer fewer, denser sections over exhaustive ones.

### 4. What NOT to include

- Do **not** add `License`, `Contributing`, `Code of Conduct`, `Changelog`, or `Security` sections — those belong in their own dedicated files. You may link to them if the files exist, but do not write their content into the README.
- Do not include placeholder text, TODOs, or sections with no real content.
- Do **not** include frequently-changing metadata (version numbers, release dates, changelogs) directly in the README. These belong in manifest files (`plugin.json`, `package.json`, etc.) or a dedicated `CHANGELOG`. Inlining them creates a maintenance burden and causes the README to go stale.

### 5. Finish

Write the file to the project root and report:

- The path written and whether it was created or refined.
- The sections included (and any notably omitted, with the reason).
- Any logo/badge/demo assets you used or chose to skip because they were missing.
