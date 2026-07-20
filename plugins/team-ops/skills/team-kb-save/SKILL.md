---
name: team-kb-save
description: Save reusable team knowledge into the team-shared knowledge base. Use when this session surfaces a process gotcha, decision rationale, domain know-how, or team rule worth sharing with teammates, or when the user asks to save something to the team KB.
---

# Save knowledge to the team KB

Persist one piece of reusable **team** knowledge into
`<teamRoot>/ai/knowledge/` so teammates and future sessions can find it.

## Scope test (before writing)

Save here only what helps **other people on the team**: process know-how,
decision rationale, domain knowledge, working agreements. Route elsewhere:

- Repo-specific technical rules → that repo's `.claude/rules/` (capture-rule).
- Personal/machine-local facts → auto-memory.
- One-off session context → nowhere.

## Steps

1. Resolve the KB root from `<team-context>` (or `.claude/team-context.json`).
2. **Pick the topic folder** under `knowledge/` — reuse an existing topic
   (check `knowledge/_index.md`) before creating a new kebab-case one.
   Team rules go to `rules/`, newcomer material to `onboarding/`.
3. **Write one focused note** (`<slug>.md`), in the team content language
   (`<content-language>` from the context):
   - A title, 2–20 lines of body, and a `## Why` line when the value is the
     rationale.
   - Never overwrite an existing note to say something different — append a
     dated section or create a new note and link it.
4. **Update indexes**: add a one-line entry to the topic's `_index.md` (and
   to `knowledge/_index.md` if the topic is new). For a larger reshuffle,
   invoke `team-kb-index` instead.
5. **Log it**: append to `_meta/activity-log.md`:
   `- <date> [<agent>/<me>] team-kb-save: added knowledge/<topic>/<slug>.md`.
6. Confirm to the user with the saved path.
