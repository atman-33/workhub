---
name: refine-backlog
description: Audit the monday.com backlog for refinement gaps — missing acceptance criteria, missing estimates, oversized or vaguely-titled items — and propose concrete fixes and splits. Use when the user wants backlog refinement/grooming, リファインメント, to check if items are ready for a sprint, or to split a large PBI.
---

# Refine Backlog

An audit-then-apply loop: find what makes backlog items not-ready, propose
fixes, and apply only what the user approves.

## Steps

1. **Scope the audit.** Default: every non-Done item on the board
   (`node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/list-items.mjs"` — board id
   from `<scrum-context>`). The user may narrow to one group/Epic.

2. **Inspect each item.** `get-item.mjs <itemId>` for column values; where an
   Epic snapshot exists (`manage-monday-backlog`'s Epic snapshot layout),
   also check `pbi/<itemId>-*/acceptance.md`. Audit against the readiness
   checks:
   - **Acceptance criteria** — an `acceptance.md` or a filled criteria/doc
     column exists and is non-empty.
   - **Estimate** — the points/estimate column has a value.
   - **Size** — estimate above the team's threshold (default: > 8 points, or
     the board's obvious outliers) → split candidate.
   - **Clarity** — title states an outcome, not a vague topic ("Improve UX"
     fails; "Show validation errors inline on the signup form" passes).
   - Completion criterion: every in-scope item has a verdict on all four
     checks — ready, or listed with its specific gaps.

3. **Report the audit.** A table in chat: item (id + title) → gaps → proposed
   fix. For each gap the proposal is concrete, not generic:
   - Missing criteria → draft 2–4 Given/When/Then criteria from the item's
     title, docs, and updates.
   - Missing estimate → don't invent one; flag it for the team's estimation
     (sizing is a team act, not the agent's).
   - Oversized → a concrete split into independently-valuable slices, each
     with a proposed title.
   - Vague title → a rewritten outcome-stating title.

4. **Apply what's approved.** monday writes are workspace-visible — apply
   only items the user explicitly approves, and per approved item:
   - Criteria for an item with a scaffolded pbi folder → write them into its
     `acceptance.md`.
   - Title rewrites, new items from a split, or column edits → beyond the
     bundled scripts' surface (they only do status and links). Use the
     `monday-api-mcp` server (confirm connected via `/mcp`; list the
     available `mcp__monday-api-mcp__*` tools before assuming names). If it
     isn't connected, deliver the approved changes as a paste-ready list for
     the user to apply by hand instead of failing.

5. **Summarize** — items now ready, items still blocked (and on what, e.g.
   awaiting team estimation), and changes applied vs. handed back.

## Failure modes

- `MONDAY_TOKEN` missing → scripts exit 1; point to the plugin README.
- No board id → run `setup-scrum-context` or ask.
- Board tracks no estimate column at all → skip the estimate/size checks and
  say so, rather than failing every item on them.
