---
name: report-epic-spec
description: Generate an HTML report of an Epic's currently-implemented spec and its upcoming planned features, reconciled from the backlog snapshot and the repo's actual state. Use when the user wants a "what exists now vs what's coming" summary, 仕様まとめ, or a feature-status overview for stakeholders.
disable-model-invocation: true
---

# Report Epic Spec

Turn an Epic's `.pm/` data into a stakeholder-readable answer to two
questions: **what does the product do today**, and **what is planned next** —
grounded in the code, not just the board.

## Steps

1. **Confirm the Epic** (monday group title in `mondayEpics`); ask if unclear.

2. **Refresh data** like `load-epic-context` step 2: `save-all.mjs` +
   `sync-repo.mjs` if stale (>60 min) or missing; run
   `migrate-epic-layout.mjs` if the legacy-layout guard fires. Without a
   configured repo, still proceed — the report is then board-only; say so in
   the report header.

3. **Gather the two sides**:
   - **Board**: `.pm/backlog/items/*.json` grouped by status — Done items are
     implemented-capability candidates; In Progress / not-started items are
     the plan. `prd/prd.md` gives the framing and intended scope. Read item
     files in bulk only for `{name, status, points}`; open full items only
     where the report needs the detail.
   - **Code**: `.pm/repo/branch-diff.json` (what the epic branch actually
     changed), the tail of `commits.jsonl`, and targeted reads in the
     dedicated clone (`repo-state.json` → `mirrorPath`) to describe real
     behavior where the board is vague. Flag Done items with no visible
     implementation trace, and implemented behavior no item records — do not
     silently trust either side.

4. **Write the report** to `.pm/reports/spec/spec-report-<YYYY-MM-DD>.html` —
   self-contained HTML (inline CSS, no external assets, same conventions as
   the progress report), in the workspace's document language, with:
   - **Implemented today** — user-facing capabilities in plain language,
     grouped by feature area, each mapped to its item id(s); discrepancies
     against code flagged inline.
   - **Coming next** — planned items in priority/board order with status and
     points; near-term (In Progress) separated from backlog.
   - A short header: Epic, date, epic branch + ahead/behind, data freshness,
     and whether the code view was available.

5. **Report back**: the report path, the counts per section, and any
   board↔code discrepancies found (these are also `audit-epic-consistency`
   fodder — suggest it when discrepancies are numerous).

## Failure modes

- `items/` missing or legacy layout → run `snapshot-pbl-to-drive` /
  `migrate-epic-layout.mjs` first (the scripts' guard messages say which).
- `MONDAY_TOKEN` missing → `save-all.mjs` exits 1; point to the plugin README.
- Board statuses don't distinguish done/in-progress/planned cleanly → ask the
  user how to bucket the board's actual labels instead of miscounting.
