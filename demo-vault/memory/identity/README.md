---
title: Identity — read in full, every session
type: memory-instructions
updated: 2026-09-17
---

# Identity

Who the owner is, how they decide, how they want to be talked to. **Read in
full at the start of every session** — no index, no search.

That only works while it stays small, so this layer is capped rather than
grown: adding an entry means merging or dropping another one. The cap is the
mechanism, not a tidiness rule. A judgement file nobody can read in one pass
stops being read at all.

## What belongs here

- Background and context that every task needs
- Standing preferences — how they like work done, not what they decided once
- The axes of a judgement: what an agent may settle alone, what has to come back
- Tone and voice

## What does not

- A single past decision → a `type: decision` note in `../notes/`
- Anything task- or project-specific → the project's own notes
- Anything an agent would only need occasionally → `../notes/`

The test is not importance, it is **frequency**: does every session need this,
or only the sessions that ask? A crucial fact nobody needs every time still
belongs in `../notes/`, where search will find it.

## What is here

| Note | Holds |
|---|---|
| `about-me.md` | Background, current work, where the rest of their context lives |
| `decision-policy.md` | The axes: what an agent may settle alone, what comes back, and the leanings a recommendation is built from |
| `strategist.md` | The persona and standing instructions the `/strategist` skill runs under |
| `writing.md` | How memory notes are written — voice, narrative, the evidence boundary |

## Caps

| File | Cap |
|---|---|
| Notes in this folder | 8 |
| Each note | 120 lines |
| Promoted rules (the axes) | 12 entries, 3 lines each |

A thirteenth rule arrives by merging or dropping one, never by appending.
`memory-doctor` reports a cap that is over; it never enforces one, because
which rule survives a merge is the owner's call.
