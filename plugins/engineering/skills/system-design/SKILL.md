---
name: system-design
description: Design a change or feature with the user and write the design set — proposal, per-capability specs, design (with open questions) and UML diagrams (use case, ER, sequence, file change map) — into a folder they choose. Settles the design first by interviewing the user one round at a time. Use when the user wants to design a system, feature or change before building it, asks for a design doc / spec / proposal, or wants requirements turned into design documents.
allowed-tools: Read Glob Grep Write Edit Agent Bash(git *)
---

# System design

Turn a request into a settled design and a set of design documents a human can
review and an agent can implement from. Two phases, in order: **settle the
design with the user**, then **write it down**. Writing is not a substitute for
asking — a document built on guesses reads as settled and is not.

**Planning boundary.** This skill produces documents only. Do not edit
application code, even if the request says "build it". After the documents are
written, stop and wait for a new request to implement.

## Outputs

All files go flat into the output folder — no subfolders, so the set also fits
a workhub backlog item folder:

| File | Holds | Template |
|---|---|---|
| `proposal.md` | Why, what changes, capabilities, impact | `templates/proposal.md` |
| `spec-<capability>.md` | One per capability: requirements with WHEN/THEN scenarios | `templates/spec.md` |
| `design.md` | How: context, goals/non-goals, decisions with alternatives, risks, open questions | `templates/design.md` |
| `uml.md` | Diagrams in Mermaid: use case, ER, sequence, file change map | `templates/uml.md` |

There is deliberately no task list: breaking the work into tasks belongs to
whatever runs the implementation (a task board, a TDD loop), and a second copy
here would drift.

## Steps

### 1. Take in the request

The user supplies the requirement or feature description, often with links,
notes or screenshots. Read everything they point at.

Then gather the **facts** yourself: read the relevant code, configuration,
existing docs and data models of the target repository. Delegate a broad sweep
to a sub-agent (`code-explore` when available) rather than reading dozens of
files here. Never ask the user for something you can look up.

### 2. Decide the output folder

Use the folder the user named. If they named none, ask — with a recommended
answer, not an open question:

- running inside a workhub task whose `backlog:` item is known → recommend that
  item's folder (`projects/NNNN-<slug>/backlog/B-NNN-<slug>/`);
- otherwise → recommend `docs/design/<change-name>/` in the target repository,
  where `<change-name>` is a kebab-case name derived from the request.

If the folder already holds a design set, ask whether to revise it or start a
new folder. Revising means reading the existing files first and editing them,
not regenerating from scratch.

### 3. Settle the design (grilling)

Interview the user until the design is shared understanding. Keep a **design
tree** in mind: every decision branches into the decisions that hang off it.

- Work in **rounds**. The **frontier** is every decision whose prerequisites
  are already settled. Ask the whole frontier in one round — numbered, each
  with your recommended answer and its reason — then wait:

  ```
  ❓ **Q1 — <title>**: <question, with the options if there are any>

  ➡️ <recommended answer> — <why>
  ```

- A question whose answer depends on another question still open this round
  belongs to a later round.
- Answers reshape the tree. Recompute the frontier and ask the next round.
- Facts are yours to find; decisions are the user's. If a question turns on a
  fact, look it up (or dispatch a sub-agent) instead of asking.
- Cover what the documents will need: actors and use cases, scope and
  non-goals, data (entities, ownership, lifecycle), the main flows and their
  failure paths, external interfaces and compatibility, and which files or
  modules change.
- Minor details that do not change scope, observable behaviour, compatibility
  or acceptance criteria: assume, and record the assumption in `design.md`.

The phase ends when the frontier is empty. Summarise the settled decisions in a
few lines and ask the user to confirm before writing anything.

### 4. Write the documents

Write in the user's language (the language of the conversation, unless they ask
otherwise). Keep each template's section structure; translate its headings
into that language if it is not English. Template comments are guidance for
you — never copy them into the output.

Order, each reading the files already written:

1. `proposal.md` — the contract for the rest. Its **Capabilities** list decides
   which spec files exist.
2. `spec-<capability>.md` — one per capability in the proposal, named with the
   same kebab-case id.
3. `design.md` — reference the proposal and specs instead of restating them.
4. `uml.md` — only the diagrams that apply (see the template for when each one
   does). Say in the file which were omitted and why.

Each template states what belongs in its file and what does not; follow it.

### 5. Sort the open questions

Writing surfaces gaps. For each one, decide which kind it is:

- **Deferrable** — can be answered later without changing the specs, the
  approach or how the work breaks down. Leave it in `design.md`'s
  `## Open Questions`.
- **Blocking** — would change any of those. Do not park it. Go back to step 3,
  ask it (with a recommendation), then update the documents.

Open questions are for genuinely deferrable unknowns, never for decisions you
skipped.

### 6. Report and stop

List the files written with one line each, the diagrams omitted and why, and
the deferrable open questions left. Then stop: implementation is a separate
request.

## Guardrails

- Re-read a file from disk before editing it; the user may have changed it.
- Specs describe observable behaviour — never class names, libraries or
  step-by-step implementation. That belongs in `design.md`.
- Mermaid must render: after writing `uml.md`, re-read each block and check the
  syntax (node ids without spaces, quoted labels that contain punctuation,
  one diagram type per block).
- Never write outside the output folder.

## Attribution

The document set and its section rules are adapted from OpenSpec's
`spec-driven` schema; the interview method from mattpocock/skills' `grilling`.
Both MIT — see the plugin's `NOTICE.md`.
