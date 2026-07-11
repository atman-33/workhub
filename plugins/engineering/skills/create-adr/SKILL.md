---
name: create-adr
description: Record an architecture/design decision as an ADR (Architecture Decision Record) in the target repository's docs/adr/. Use when the user wants to document a design decision, its alternatives and consequences, or says "record this decision" / "write an ADR".
allowed-tools: Read Glob Grep Write Bash(git *)
---

# Create ADR

Record one architecture decision — the "why" that code and commit messages
can't carry — as a numbered, immutable file in the target repository.

An ADR records a **decision made**, not a proposal under discussion. If the
decision isn't settled yet, help settle it in conversation first; write the
ADR after.

## Steps

1. **Locate the ADR home.** Look for an existing convention in the target
   repo: `docs/adr/`, `docs/decisions/`, `adr/`, or an existing `NNNN-*.md`
   series anywhere under `docs/`. Follow whatever exists (numbering width,
   template style). If none exists, create `docs/adr/` and start at `0001`.
   - Completion criterion: directory and next sequence number are known.

2. **Gather the decision.** From the conversation (ask only for gaps):
   the decision itself, the context/forces that made it necessary, the
   alternatives considered, and why they lost. If the decision came out of
   work in this session, pull the concrete evidence (files, constraints)
   you already have instead of re-asking.

3. **Draft the ADR** — in English, as a repository artifact. Template
   (skip a section only when genuinely empty, and keep the heading with
   "None."):

   ```markdown
   # NNNN. <Decision title, imperative — "Use X for Y">

   Date: YYYY-MM-DD
   Status: Accepted

   ## Context
   <the forces: requirements, constraints, problems that made a decision necessary>

   ## Decision
   <what was decided, stated as fact>

   ## Alternatives considered
   <each alternative and the concrete reason it was rejected>

   ## Consequences
   <what becomes easier, what becomes harder, follow-ups now required>
   ```

4. **Confirm, then write.** Show the draft to the user; on approval write
   `NNNN-<kebab-slug-of-title>.md` into the ADR home. If this ADR supersedes
   an earlier one, also edit the old ADR's `Status` to
   `Superseded by NNNN` — that edit is the one exception to ADR immutability.
   - Completion criterion: file written; any superseded ADR's status updated.

5. **Report** the file path and suggest committing it with the related change
   (`docs: add ADR NNNN — <title>`).

## Failure modes

- The "decision" is still an open question → don't write a `Status: Accepted`
  ADR for it; either help decide first or, if the user wants the open state
  recorded, use `Status: Proposed` and say so.
- Two decisions in one request → two ADRs; one record per decision.
