---
name: strategy-decompose
description: Decompose a strategy handed down from above into a hierarchy of aspects and states, audit it for necessity, sufficiency and overlap, and output it as an xlsx. Use before writing your own team's or unit's policy from a company/department/team strategy, when the user wants to break a strategy down into "what state we need to reach", or asks to check whether a decomposition is MECE.
argument-hint: "<path to the upper strategy material>"
---

# strategy-decompose — turn an upper strategy into your organization's target states

The output is not a policy. It is the **material** a policy is written from: the
states your organization has to reach for the upper strategy to hold.

Work through phases 1-5 in order. **Do not start a phase until the previous
phase's completion criterion is met.**

## Settle the destinations first

Before any work, pin down two locations. Ask the owner if either is unclear.

- **Where the notes go** — a Markdown home the owner and future sessions read
  (in a workhub vault: `projects/<slug>/dev-notes/` and `research/`)
- **Where the xlsx goes** — somewhere the owner can actually open it. If the
  notes live in a vault the owner reads through Obsidian, the xlsx does **not**
  belong there; put it on their cloud drive

Always write to the **AI-owned workbook** (`<name>-draft.xlsx`), never to the
owner's (`<name>.xlsx`). See [`references/xlsx-format.md`](references/xlsx-format.md).

## Phase 1 — take in the upper strategy

1. Read the material. **Store the original verbatim** — never a summary. In a
   vault, `projects/<slug>/research/`
2. Identify the hierarchy (e.g. company → department → team → your unit). For
   each level write down what it commits to and where it gets measured
3. Capture spoken context too (kickoff Q&A, decisions made in a meeting). Later
   phases lean on "agreed but not in the document" material

**Completion criterion**: the original is stored, each level's objectives are
listed, and you can say in one sentence which item your own organization hangs off.

## Phase 2 — remove the unknowns (discussion)

An upper strategy is rarely decomposable as written: too abstract, subject
omitted, no definition behind a number. Close that gap here.

1. For every sentence of the upper strategy, ask yourself: **can I state, in one
   sentence, the state in which it is achieved?**
2. Turn each sentence you cannot state into a question. **Every question carries
   a recommended answer** so the owner only has to choose
3. At most **5 questions per round** — more and the answers get careless
4. Append the answers next to the stored original, recording how each question
   was settled

**Completion criterion**: every sentence of the upper strategy has its achieved
state in one sentence, and no question is left open.

## Phase 3 — decompose

The shape is in [`references/decomposition-rules.md`](references/decomposition-rules.md).
Write the result as the **intermediate JSON**, not by assembling a workbook by
hand. The schema is in [`references/xlsx-format.md`](references/xlsx-format.md).

Two questions run continuously while you decompose:

- **Necessity** — is this child required for the parent to be achieved?
- **Sufficiency** — if every child is achieved, is the parent achieved?

**Completion criterion**: every Level 5 is a state ("we can …", "… is in place"),
one state per cell, and Level 1 is the upper strategy's **wording verbatim**.

## Phase 4 — audit

Auditing your own decomposition goes soft. Hand it to the **`strategy-auditor`
agent**, which looks at necessity, sufficiency and overlap only.

1. Launch `strategy-auditor` with three things
   - the path to the intermediate JSON
   - the path to the stored original
   - **decisions the owner has already made** ("this branch stays", "we are not
     building strategy 2"). Without them the auditor reopens settled questions
2. Work the findings one at a time
3. Fix what you accept in the JSON. For the rest, **record why it is deferred**

**Completion criterion**: every finding is marked either applied or deferred with
a reason. None left unhandled.

## Phase 5 — output

1. Build the workbook
   ```bash
   python <skill>/scripts/build_xlsx.py <input.json> <output.xlsx>
   ```
   To pull an existing workbook back into JSON (round-tripping an owner's edits):
   ```bash
   python <skill>/scripts/read_xlsx.py <input.xlsx> <output.json>
   ```
2. Write to the AI-owned workbook, copying the current file into `.backup/`
   first
3. Write a human-readable summary in Markdown next to the notes: the domains,
   the design decisions, the audit findings and what happened to each
4. Report to the owner: **which file, which sheet, how many rows**

**Completion criterion**: the workbook exists, its path is reported, and the
Markdown summary is written.

## What comes after

This skill stops at the decomposition. Turning it into a policy — narrowing the
states down, grouping them into a handful of policies, assigning roles, deriving
actions and KPIs — is separate work that starts from this output.
