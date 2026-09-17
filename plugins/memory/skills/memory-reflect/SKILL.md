---
name: memory-reflect
description: Promote what a session learned from the short-term record into durable memory - review recent episodes and conversations, keep what will matter next time, and write it as typed notes. Use at the end of a session, when the user asks to reflect/consolidate/remember what was learned, or when memory-doctor reports the episodes cap.
---

# memory-reflect — promote what will matter next time

This is the step that makes memory compound. Without it the store only grows:
a pile of transcripts and checkpoints that each get less useful as they age.
With it, what a session worked out survives as something a later session can
find in one query.

Memory is formed best **between** sessions rather than during one — the work
of deciding what mattered is easier once the work is over.

## What this may do on its own, and what it may not

The line is reversibility, not importance. `profile/decision-policy.md`'s
gray-zone rule already draws it: reversible → proceed, irreversible → ask.

| Action | Do it |
|---|---|
| Write a **new** note in `notes/` or `notes/` | Without asking. A new file in a git-tracked folder is undone by deleting it |
| **Archive** a note that is finished | Without asking. A move is reversible, and the note stays in the graph |
| **Rewrite or merge** an existing note | Propose it. Show what would be lost |
| Touch anything in **`identity/`** | Propose it. It is capped, so adding means removing |
| **Delete** anything | Don't. Archive instead |

**Everything done without asking is reported.** End with one line per note
written or moved. Something that changes the record silently is
indistinguishable from something that is broken — which is exactly how 46 days
of capture loss went unnoticed (T-0366).

## Steps

### 1. Gather what is recent

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" recent --limit 30
```

Plus the open checkpoints in `memory/episodes/` and, when the user names a
subject, `memory-recall` for that subject.

### 2. Decide what is worth keeping

Ask of each thing, in order. The first `keep` wins; anything that reaches the
bottom is dropped.

| Keep | Because |
|---|---|
| A **decision** with a rationale and an alternative | It stops the same ground being relitigated |
| A **lesson** — something that went wrong and why | It stops the same failure |
| A **constraint** discovered the hard way | It is invisible in the code |
| A **preference** the owner stated as standing, not once | It changes how future work is done |
| The **shape** of something: how a system is put together, why it is that way | It is the expensive thing to re-derive |

| Drop | Because |
|---|---|
| What happened, without what it means | The transcript already has it |
| Anything already written down | A duplicate splits a subject in two |
| A one-off answer with no rule behind it | It will never match a future question |
| Anything the user clearly does not want kept | Obviously |

**Be selective.** The point is distillation, not a second copy of the
transcript. If a session produces nothing worth promoting, say so and stop —
that is a normal outcome, not a failure to try hard enough.

### 3. Write it, typed

Search before creating — two or three wordings, and a proper noun by title
rather than by meaning. If the subject already has a note, propose an update
instead of adding a second one.

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" new decision "What it is about"
node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" validate memory/notes/<file>.md
```

| It is | Type |
|---|---|
| A choice, with what it rules out | `decision` |
| A trap, with what to do instead | `lesson` |
| How something works, or a fact | (none required) |

All three go in `notes/`. The type does the distinguishing — a folder would
only add a routing decision with no reliable rule behind it.

Fill `[alternative]` and `[consequence]` where the session actually produced
them. **Do not invent either.** A rejected option nobody considered is worse
than an absent field: it reads as settled ground and closes off a real option.

Write the body in prose. Search returns passages from it, so a note with
context is both easier to find and worth more when found.

### 4. Close the episodes you promoted from

Set `status: closed` on a checkpoint whose content now lives in a durable note,
and archive it if nothing else refers to it. Leave `status: open` on anything
still in flight — that is what the next session's brief reads.

### 5. Report

```
memory: 2 written, 1 archived
  + notes/rate-limiting.md           decision — token bucket over fixed window
  + notes/wasm-sqlite-read-locks.md  lesson — get() holds a SHARED lock
  → archive/xy12-t-0366.md          promoted, closed
```

Then anything you did **not** do on your own, as a proposal with its reason.

## Notes

- If `memory/` does not exist, this vault has not been given a store yet. Say
  so and stop; do not create one from here.
- Uncertain but probably important beats dropped: write it with `(要確認)` in
  the observation rather than leaving it out.
- Never claim something was verified unless it was. A memory that records a
  test as passing when it never ran is worse than an empty one.
