---
name: team-kb-query
description: Answer questions from the team-shared knowledge base. Use when the user asks about team rules, working agreements, domain knowledge, past decisions, or anything a teammate might have documented in the shared folder.
---

# Query the team KB

Answer from `<teamRoot>/ai/knowledge/` with citations, instead of guessing.

## Steps

1. Resolve the KB root from `<team-context>`.
2. **Navigate via indexes first**: read `knowledge/_index.md`, pick candidate
   topic folders, read their `_index.md`, then only the notes that look
   relevant. Fall back to Grep across `knowledge/` for specific terms.
   For project-specific questions also check
   `projects/<p>/docs/spec/spec.md` and `docs/decisions/`.
3. **Synthesize** an answer in the user's language, citing each source note
   by path so they can open it.
4. **Flag gaps**: if the KB does not answer the question (or is out of
   date), say so explicitly — and once the user supplies the real answer,
   propose saving it with `team-kb-save`.

## Rules

- Read-only: this skill never modifies the KB.
- Prefer newer notes when two conflict, and surface the conflict.
