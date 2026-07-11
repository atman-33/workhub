---
name: write-retrospective
description: Facilitate and record a sprint retrospective for a PBL Epic — prepare sprint facts from the monday.com board, walk the user through Keep/Problem/Try, save the notes to the Epic's Drive folder, and track action items. Use when the user wants a retrospective, ふりかえり/レトロ, or to record what went well and what to improve after a sprint.
---

# Write Retrospective

Facilitate, then record. The user supplies the judgments (what went well,
what hurt); this skill supplies the facts, the structure, and the record.

## Steps

1. **Confirm the target.** Epic (monday board group, folder from
   `<scrum-context>`'s `mondayEpics`) and sprint window (default: since the
   previous file in `<epicFolder>/retrospectives/`, else the last 7 days).

2. **Prepare the facts.** Objective inputs the discussion anchors on:
   - Board outcomes for the window: done / carried over
     (`node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/list-items.mjs"`, or the
     Epic's `.pm/backlog/` if fresh).
   - The previous retrospective's **Try** action items, if a prior file
     exists — each one gets a follow-up verdict this time.
   Present these before asking any opinion question, so the discussion starts
   from data, not vibes.

3. **Facilitate KPT.** Ask the user in three passes — **Keep** (worth
   continuing), **Problem** (what hurt), **Try** (what to change next
   sprint) — one pass at a time, offering 1–2 candidate observations from the
   step-2 facts each pass (e.g. a recurring carry-over is a Problem
   candidate). The user's answers are the content; your candidates are
   prompts, marked as suggestions if they only confirm them.
   - Completion criterion: each pass explicitly closed by the user ("that's
     all"), and every previous Try item has a verdict
     (kept working / dropped / still pending).

4. **Extract action items.** From **Try**, make each action concrete: what,
   who (default: the user), and a due signal (next sprint / a date). An
   unownable Try ("communicate better") gets reshaped with the user or
   recorded as a theme, not an action.

5. **Save the record.** Write Markdown (repository/Drive artifact — English
   unless the discussion was held in another language; then match it) to
   `<epicFolder>/retrospectives/<yyyy-MM-dd>-retro.md`:

   ```markdown
   # Retrospective — <Epic> — <sprint window>

   ## Sprint facts
   ## Previous actions — follow-up
   ## Keep
   ## Problem
   ## Try
   ## Action items
   - [ ] <action> — <owner>, <due>
   ```

6. **Track the actions.** Ask whether action items should go on the monday
   board. If yes: creating items is beyond the bundled scripts (status and
   links only) — use the `monday-api-mcp` server (confirm connected, list its
   tools before assuming names); if unavailable, the checklist in the retro
   file is the tracking record — say so. Report the saved path and the action
   list.

## Failure modes

- Epic not in `mondayEpics` → run `setup-scrum-context` or ask for the folder.
- User wants a different format (4Ls, Start/Stop/Continue) → keep the same
  steps, swap the section headings.
- Solo project → keep facilitation lightweight (one pass may suffice), but
  the previous-Try follow-up still runs; that loop is the point of a retro.
