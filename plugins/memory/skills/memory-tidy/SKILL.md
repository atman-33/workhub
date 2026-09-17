---
name: memory-tidy
description: Keep memory small enough to stay useful - report which caps are over, propose merges, split bloated notes, archive what is finished, and connect orphans. Use when memory-doctor or the session brief reports a cap, when memory feels noisy, or on a periodic review.
---

# memory-tidy — forgetting, on purpose

Promotion without forgetting just makes a bigger pile. `identity/` is read in
full on every session, so its size is not a matter of taste: a note nobody can
read in one pass stops being read at all, and then the judgement it holds stops
applying.

So the layers have caps, and reaching one is the signal to consolidate. The cap
is the mechanism — not a tidiness rule, and not a number to raise when it gets
inconvenient. It already works: `memory/identity/decision-policy.md` has held to "12
promoted rules, 3 lines each, a thirteenth arrives by merging or dropping one"
and it is the one part of the harness that has never bloated.

## What this may do on its own

| Action | Do it |
|---|---|
| **Archive** a finished or superseded note | Without asking. Reversible, and it stays in the graph |
| **Add a missing link** between two notes | Without asking |
| **Merge** two notes, or rewrite one | Propose it. Show what would be lost |
| Change anything in **`identity/`** | Propose it. Always |
| **Delete** | Don't. Archive instead — a deleted note takes its observations and its inbound links with it, and they break silently on the other side |

Report everything done without asking, one line each.

## Steps

### 1. Measure

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" doctor
```

| Cap | Limit | Why that one |
|---|---|---|
| `identity/` notes | 8 | Read in full, every session |
| One `identity/` note | 120 lines | The same |
| `episodes/` notes | 60 | Past this, promotion has stopped happening |

A cap is a prompt to consolidate, never a licence to delete.

### 2. Find what is actually wrong

| Problem | Signal | Fix |
|---|---|---|
| Bloated note | Over 300 lines, several subjects | Split by subject; keep the axes, move the cases out |
| Duplicates | Two notes on one subject | Merge, then `supersedes` the loser (do not delete it) |
| Stale | Refers to work that finished, decisions since overturned | Archive, or mark `status: superseded` and link the replacement |
| Orphan | No inbound link, in no index | Link it, or ask whether it is still wanted |
| Contradiction | Two notes disagree on a fact | **Surface it. Do not pick one silently** — ask which is true |
| Un-promoted | `episodes/` full of `status: open` checkpoints | Run `memory-reflect` first; this skill is the wrong tool |

### 3. Consolidate, in this order

1. **Archive** what is plainly finished. Cheapest, reversible, often enough on
   its own.
2. **Merge** duplicates — propose each one.
3. **Split** what is over its cap — propose each one.
4. **Re-measure.** If a cap is still over after the first three, the layer has
   a real excess and the owner has to choose what goes.

Never renumber or rename to tidy up. It breaks every link into a note and buys
nothing a reader can see.

### 4. Record what it cost

When a merge drops something, say what. A consolidation that quietly loses a
rule is worse than the bloat it fixed.

Add anything that has now gone wrong **twice** to `memory/README.md`'s
`## Known failure modes`. That section tends to become the most valuable thing
in the store, and it only grows if someone puts things in it.

## Report

```
memory: 3 archived, 1 link added — identity 9/8 still over

  → identity/preferences.md is 140 lines (cap 120)
    Proposal: move the six worked examples to notes/, keep the four axes.
    Lost: nothing — the examples keep their own note.

  → identity/ holds 9 notes (cap 8)
    Proposal: merge tone.md into about-me.md; they are two paragraphs each.
```

Proposals first, with what each one costs. The owner decides which rule
survives — that is not a judgement to make on their behalf.
