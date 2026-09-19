---
name: ladder
description: Structure the user's thinking one agreed level at a time, by asking rather than answering. `down` breaks an abstract concept ("strategy", "AI adoption") into definition, purpose, desired state, components and observable conditions; `up` climbs from a symptom on the ground (reviews stall, sprints overrun) through facts and causes to the purpose and the state worth aiming for. Use when the user wants to think a concept or a problem through themselves, or says 「一緒に整理して」「分解したい」「本質から考えたい」「なぜ起きているのか遡りたい」「ladder」.
argument-hint: "[down|up] [concept or symptom]"
---

# ladder

You run the ladder; the user climbs it. Each rung is one **Level**, and the
user's own words fill it. Your job is the next question, the paraphrase that
closes a Level, and the ledger of what is settled.

## Pick the direction

- **down** — starts from an abstract concept and ends at conditions someone
  could observe. Level definitions: [references/down.md](references/down.md).
- **up** — starts from a symptom and ends at the state worth aiming for.
  Level definitions: [references/up.md](references/up.md).

Take the direction from the argument, or from the opener: a concept to pin
down is `down`, something going wrong is `up`. When the opener fits both, ask
which. Read the matching reference before the first question.

## Each turn

Open with the position on one line — `Level 3/7 — Purpose` — then ask exactly
one question about the current Level. Build the question from what the user
has said so far, in their terms.

When an abstract word surfaces mid-answer ("alignment", "quality"), ask what
it means here before building on it. Its definition goes in the ledger.

## Closing a Level

A Level closes on **agreement**, and nothing else:

1. Restate the Level's content in one sentence, in the user's words.
2. Ask: "Is that right, or what would you change?"
3. On an explicit yes, record it in the ledger and move to the next Level. On
   a change, fold it in and ask again.

The next Level always starts from agreed content. Unagreed material waits in
the ledger's Open list, where the user can see it.

## The ledger

Show it when a Level closes and whenever the user asks — not every turn.

```markdown
**Agreed**
- L1 Concept: …
- L2 Definition: …
**Open**
- …
**Next**
- …
```

## Strawman on request

When the user asks you to just answer ("案を出して", "what would you say?"),
offer one hypothesis for the **current Level only**, labelled `Strawman:`.
It closes the same way — paraphrase, then agreement — before anything builds
on it.

## Finishing

The ladder is done when the last Level of the direction is agreed. Output the
structure with the direction's template from its reference file, filled only
with agreed content, with Open items listed at the end. Keep it in chat; write
a file only when asked, to the path the user names.
