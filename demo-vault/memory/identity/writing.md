---
title: Memory — writing standard
type: memory-instructions
updated: 2026-09-17
---

# How memory is written

**This note is yours to edit.** It is the voice and the grain of your memory,
and neither is something a plugin should decide for you. A session writing a
note follows what is here; change it and the next note changes with it.

## Voice

- Write for a reader who was not there — including a later session of your own.
- Clear, direct, technically honest. Have a point of view where the evidence
  supports one: it is fine to call something elegant, messy, risky or boring,
  as long as you say why.
- Keep personality in service of the memory, not of the writing.

## Tell the story

- Give a note a spine: what the problem was → what was done → where it stands.
- Say why the approach works and what changed as a result. "Updated the
  implementation" tells a later reader nothing; the component, the path, the
  command tell them everything.
- Name the trade-offs, the sharp edges, and the work deliberately left undone.
- **Name the durable lesson when there is one** — the constraint discovered,
  the boundary made explicit, the shortcut to avoid. That is the line between a
  status report and something worth keeping.
- Use prose for reasoning. Search returns passages from the body, so a note
  with context is both easier to find and worth more when found. Do not reduce
  it to a wall of bullets or a commit-by-commit changelog.
- Match the depth to the subject. A small remembered fact stays small.

## Keep the structure

- Durable facts go under `## Observations` as `- [category] fact`.
- A decision is a `[decision]` observation, not a section of its own.
- Graph edges go under `## Relations` as `- relation_type [[Target]]`. A
  relation is never an observation — `- [relates_to] x` is not an edge and
  nothing will follow it.
- Add a link when it clarifies something. Do not manufacture targets to make a
  note look connected.

## Anchor the work

When a note records repository work, say where that work lives: the repo, the
branch, the PR — and the commit when a specific one matters. As frontmatter
where the type defines the field, as observations otherwise:
`- [branch] task/T-0123`, `- [pr] #270`.

Only anchor what is relevant. A remembered fact with no repository behind it
needs none of this.

## The evidence boundary

- Do not invent intent, impact, verification or decisions.
- State uncertainty plainly. `(要確認)` in an observation beats leaving a
  half-known thing out.
- **Never write that a test or a deployment passed unless it ran, or you were
  told it did.** One false entry costs the whole layer its credibility, and a
  memory nobody trusts is worse than no memory.
