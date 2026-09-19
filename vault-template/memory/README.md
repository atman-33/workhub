---
title: Memory — startup router
type: memory-router
updated: 2026-09-17
---

# Memory — startup router

**Read this note at the start of every session, before any memory work.**
It is the only note here that is always read. Everything else is loaded when a
task needs it, which is what keeps memory from eating the context window.

## Non-negotiable rules

1. **Search before you create.** Try two or three wordings. A proper noun is
   found by title, not by meaning. A duplicate splits a subject in two and the
   next reader cannot see that it happened.
2. **Read a note in full before overwriting it.** Never reconstruct one from
   memory of what it said.
3. **Archive, never delete.** Deleting a note removes its observations and its
   links from the graph. Move it to `archive/` instead.
4. **Stamp `type:`.** A note with no type is invisible to structured recall —
   which is how a session finds open decisions and work in flight.
5. **Add, freely. Rewrite, deliberately.** Creating a note and moving one are
   reversible, so do them without asking. Rewriting, merging and anything under
   `identity/` is not: propose it and wait.
6. **Say when memory changed.** One line at the end of a session naming what
   was written. Something that changes the record silently is indistinguishable
   from something that is broken.

## Where things go

| Task | Read, in order |
|---|---|
| Anything about the owner: who they are, how they decide, tone | `identity/` — all of it, it is small on purpose |
| A fact, a term, a settled decision, how a system is built, a trap to avoid | `notes/` — search it, do not read the folder |
| "Where did we leave off" | `episodes/`, newest first |
| A constraint about particular code | **not here.** That is a `.claude/rules/` file in the repository it is about |
| The owner's own reference material | **not here.** `knowledge/` at the vault root |
| Unsure | Ask. Do not guess a location |

## Layers

The split is by **how something reaches a session**, not by what it is about.
That is the only axis that holds: "is this a fact or a procedure" has no answer
you can rely on at 2am, while "is this read every time, or only when searched"
always does.

| Folder | Reaches a session | Lifetime |
|---|---|---|
| `identity/` | **Always**, in full | Permanent, **capped** — a new entry replaces one |
| `notes/` | **When searched.** Needs a `type:` to be findable | Permanent, revised in place |
| `episodes/` | When searched; also the live ones in the opening brief | Decays; what matters is promoted upward |
| `.index/` | Never directly — reserved for a search index over `notes/` | Disposable |

**The Markdown is the record. Any index is a cache.** Anything in `.index/` can
be thrown away and rebuilt; nothing in the folders above it can.

Search goes through one entry point, `cli.mjs notes` (the `memory-recall`
skill). Today it scans the Markdown directly, and `.index/` stays empty — at a
few hundred notes a scan is fast, exact, and has nothing to keep in sync. When
the store outgrows it, `memory-doctor` says so (`notes search`), and the scan is
replaced by a derived index in `.index/` behind the same command. Nothing that
searches has to change. This vault is meant to be used for years; that is the
point of keeping the entry point fixed and the implementation swappable.

`identity/` is capped and `notes/` is not, and that follows from the table
rather than from taste: something read in full every session has to stay
readable in one pass, and something reached by search does not care how many
neighbours it has.

Two things deliberately live outside this folder:

- **`.claude/rules/`** — a constraint that fires when a matching *path* is
  touched. Memory has no such channel, and a rule about particular code is
  useless unless it arrives while that code is open.
- **`knowledge/`** — the owner's own reference material. Nothing injects it;
  they read it.

## Promotion and forgetting

What a session learns reaches this folder through `memory-reflect`, and what
stops being worth keeping leaves through `memory-tidy`. Neither is automatic,
and neither is silent.

The line between what an agent does on its own and what it proposes is
**reversibility**, not importance:

| Reversible → just do it | Irreversible → propose it |
|---|---|
| Write a new note | Rewrite or merge an existing one |
| Archive a finished one | Change anything in `identity/` |
| Add a missing link | Delete anything (so: don't — archive) |

Everything done without asking is reported, one line each.

**The caps are the forgetting.** `identity/` is read in full every session, so
a note nobody can read in one pass stops being read at all — and then the
judgement it holds stops applying. Reaching a cap is the signal to consolidate,
never a number to raise.

| Layer | Cap |
|---|---|
| `identity/` notes | 8 |
| One `identity/` note | 120 lines |
| `episodes/` notes | 60 |

## Known failure modes

Add to this list whenever the same mistake happens twice. A documented mistake
stops recurring; an undocumented one does not. This section tends to become the
most valuable thing in the whole store.

- *(nothing recorded yet)*

## The three types

`type:` is what makes a note findable later. A session briefing asks for open
decisions and recent sessions by type — it does not ask for "notes that look
relevant" — so an untyped note is invisible rather than merely untidy.

| Type | Answers | Carries |
|---|---|---|
| `decision` | what was chosen, and what it rules out | `[decision]`, `[rationale]`, `[alternative]`, `[consequence]`, `affects`, `supersedes`, `status:` |
| `session` | where the work stopped | `[summary]`, `[context]`, `[next_step]`, `[decision]`, `[problem]`, `produced`, `status:` |
| `lesson` | what not to do again | `[symptom]`, `[cause]`, `[instead]`, `[seen_at]` |

Two of those fields do most of the work and are the ones usually skipped:

- **`[alternative]`** — what was rejected. Without it a later session has no way
  to know the ground was already covered, and relitigates it.
- **`[problem]`** on a session — dead ends, including approaches tried and
  abandoned. This is what stops the next session suggesting the thing that
  already failed.

Start one with a blank of the right shape:

```bash
node "<memory plugin>/engine/cli.mjs" new decision "What it is about"
node "<memory plugin>/engine/cli.mjs" validate memory/knowledge/*.md
```

**Validation only ever warns.** A type describes a subset, not a straitjacket:
an observation or link it does not mention is a richer note, not a broken one,
and nothing here can refuse a write. A memory whose writes can be rejected
stops being written to, and an empty memory is worse than an untidy one.

- `[category]` is free-form. Consistency inside a folder helps; there is no
  fixed list.
- A link may point at a note that does not exist yet.
- Link both ways for anything paired. One-directional links rot — the other
  side finds nothing.

## Note format

One entity per file. The whole grammar is three things: frontmatter, facts,
links.

```markdown
---
title: <name>
type: knowledge      # knowledge | howto | decision | session | lesson
tags: [...]
---

# <name>

Prose. Background, reasoning, what was tried. Write generously here — search
returns passages from the body, so a note with context is both easier to find
and worth more when found. Do not reduce it to bullets.

## Observations
- [fact] one fact per line, specific #tag
- [decision] the choice, not the topic
- [lesson] what to do differently next time

## Relations
- relates_to [[Another Note]]
- supersedes [[The Older One]]
```
