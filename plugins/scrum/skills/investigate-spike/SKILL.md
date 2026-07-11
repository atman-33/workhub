---
name: investigate-spike
description: Investigate a spike task from an Epic's backlog using the Epic's dedicated repo clone, and save a findings report the team can decide from. Use when the user mentions a spike, スパイク調査, or wants a technical question from the backlog researched against the actual codebase.
---

# Investigate Spike

A spike is a time-boxed research task whose deliverable is knowledge, not
code. This skill runs the research against the Epic's dedicated clone and
leaves a report next to the Epic's other machine-managed data.

## Steps

1. **Identify the spike item.** If the user named one, use it. Otherwise list
   the Epic's items (`node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/list-items.mjs"`)
   and look for spike markers — a name starting with `Spike` / `[Spike]` /
   `スパイク`, or a type/status column that marks spikes on this board. If
   nothing matches, show the candidates and ask; do not guess. When the board
   uses a different convention, note it for `setup-scrum-context` so it can
   be recorded.

2. **Load the question.** `get-item.mjs <itemId>` plus the item's saved
   updates (`.pm/backlog/updates/<itemId>.json`) and, if scaffolded,
   `pbi/<itemId>-*/acceptance.md` — the spike's question and its
   "done when we know X" criterion. If the question is ambiguous, confirm it
   with the user before spending investigation effort.

3. **Prepare the code.** Run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/repo/sync-repo.mjs" "<groupName>"` so
   the dedicated clone (`.pm/repo/repo-state.json` → `mirrorPath`) is current
   on the epic branch. The clone is the spike's dedicated workspace — never
   investigate in the user's own development checkout. Read-only: no edits,
   no branch switching beyond what `sync-repo.mjs` did.

4. **Investigate.** Answer the spike question with evidence: trace the
   relevant code paths in the mirror (`file:line` citations), consult library
   docs where the question involves external dependencies, and run read-only
   commands in the mirror if needed. Delegate broad sweeps to a read-only
   exploration agent (`code-explore`) and fold back conclusions. Time-box:
   when findings are sufficient to decide, stop — a spike ends at "enough to
   decide", not at exhaustive coverage.

5. **Write the report** to `.pm/reports/spikes/<itemId>-<slug>.html` — a
   self-contained HTML document (inline CSS, no external assets, same
   conventions as the progress report): the question, what was examined,
   findings with `file:line` evidence, options with trade-offs, and a
   recommendation. Slug: short kebab-case from the item title.

6. **Close the loop.** Report the recommendation + report path in chat. Offer
   (user approval required — monday writes are workspace-visible) to post the
   conclusion and report location as an update on the monday item via the
   `monday-api-mcp` server, and/or to set the item's status via
   `update-item-status.mjs`.

## Failure modes

- No `repo` configured for the Epic → the spike may still be researchable
  from docs alone; say the code view is unavailable and ask whether to
  proceed docs-only or configure the repo first.
- `MONDAY_TOKEN` missing → scripts exit 1; point to the plugin README.
- Spike question spans a repo other than the Epic's → ask for the repo URL
  and pass it as `sync-repo.mjs` `--repo-url`/`--epic-folder` overrides
  rather than silently investigating the wrong codebase.
