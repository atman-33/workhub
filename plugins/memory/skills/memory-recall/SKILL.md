---
name: memory-recall
description: Search what the workhub vault remembers - the distilled record in memory/ (decisions, lessons, where sessions stopped) first, then the verbatim past conversations. Use when the user asks what was discussed or decided before, says "recall", "思い出して", or wants to check past session context beyond what was auto-injected.
argument-hint: "[query] [days]"
---

# memory-recall — Search what is remembered

Memory has two stores, and they hold the same history at different stages:

| Store | What is in it | How it is searched |
|---|---|---|
| `memory/notes/` + `memory/episodes/` | The **distilled** record: one typed note per decision, lesson or stopped session. In git | `cli.mjs notes` — type/status filters plus terms |
| `_ai/state/memory.db` | Every session's **verbatim** Q&A pairs. This machine only | `cli.mjs recall` — keyword + vector search |

The distilled record answers first. It is what someone decided was worth
keeping, it carries its reasoning, and it is the thing to cite. The verbatim
conversation is the raw material behind it: search it when the notes have no
answer, or when the exact wording matters.

## Steps

1. Parse the arguments: a free-text query and an optional day window.

2. **Search the notes.**

   ```bash
   # terms (all required), in the title or the body
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" notes <terms...>

   # when the answer has a shape, filter by it
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" notes --type decision --status open
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" notes --type session --status open
   ```

   A superseded decision is left out unless you ask for it
   (`--status superseded`, or `--all`); `--archive` adds archived notes.
   Matching is literal, so if nothing comes back, try the other word for the
   same thing before concluding there is no note — "承認" and "確認" do not
   find each other.

3. **Search the conversation** when the notes did not answer, or to see what
   was actually said:

   ```bash
   # recent timeline (no query)
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" recent --limit 20

   # search all time
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" recall "<query>" --limit 5

   # search the last N days only
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" recall "<query>" --days 30 --limit 5
   ```

   Add `--full` to print untruncated texts when the clipped output is not
   enough. With no hits, widen the window stepwise (30 → 90 → 180 days → all
   time) before concluding the topic was never discussed.

4. **Synthesize, don't dump**: answer the user's actual question. Cite notes
   by `[[wikilink]]` and conversations by date (and task id when present).
   When a note and a conversation disagree, say so — the note is usually the
   later, considered version, but not always.

## Notes

- `notes` needs no setup: it reads Markdown. `recall` and `recent` need the
  engine — if the CLI reports it is not set up, run the `memory-setup` skill
  first (or tell the user to).
- Also works from OpenCode or a plain terminal — it is just a Node CLI.
