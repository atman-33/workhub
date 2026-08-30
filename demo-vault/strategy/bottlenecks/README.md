---
title: Bottlenecks
created: 2026-08-30
type: strategy
tags:
  - strategy
  - bottleneck
---

# Bottlenecks

What is actually stopping you, one file per bottleneck in this folder. A
bottleneck is a wall you keep hitting — not a task, and not a wish. If it would
be gone after an afternoon's work, it belongs in `tasks/`.

One file each rather than one long list, because a bottleneck accumulates: what
you tried, what it cost, what you learned. That history is what stops the
`strategist` skill proposing the same fix you already failed at.

## File convention

`<slug>.md` in this folder, English kebab-case. Frontmatter:

```yaml
title: Cannot ship without a designer
created: 2026-08-30
updated: 2026-08-30
type: bottleneck
status: open        # open | easing | resolved
severity: high      # low | medium | high
blocks: [[strategy/current/roadmap]]   # optional; what it is holding up
tags: [strategy, bottleneck]
```

Body sections:

| Section | Contents |
|---|---|
| `## Symptom` | What you observe. Concrete, with dates. |
| `## Why it persists` | Your current theory. Revise it, do not delete it. |
| `## Tried` | What you attempted and what happened. Append only. |
| `## Next` | The one thing you will try next. |

A resolved bottleneck stays here with `status: resolved` — deleting it throws
away the only record of what worked.

## How the strategist uses this folder

It reads every open file and cross-checks them against
[[strategy/current/roadmap]] and [[strategy/north-star/mvv]]. The contradiction
it is looking for is a roadmap that quietly assumes a bottleneck is gone.

Being empty is a legitimate state. It is also a suspicious one: if nothing is
blocking you, the skill will ask what you are avoiding writing down.

This note is seeded once and never overwritten by a template sync — edit it
freely.
