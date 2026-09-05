---
title: Decision log
created: 2026-09-05
type: reference
tags:
  - profile
---

# Decision log

Every call you have settled, oldest first. This is the long tail of
[[profile/decision-policy]]: the policy holds the axes a decision turns on,
this file holds the cases they came from.

Nothing reads this note front to back, which is why it has no size limit.
Agents grep it when the policy does not settle a question on its own and a
similar one may have come up before — so write one entry as one greppable
statement plus the question that produced it, not as prose.

Format:

```
- <date> <task-id> <the rule this establishes>
  (from: <the question it came out of>)
```

When the same reasoning settles a second question, promote it to the policy's
`## Promoted rules` as an axis and leave the entries here untouched. Entries
are never edited or deleted: a superseded one is answered by a later entry, and
seeing both is how you tell a rule changed rather than never existed.

## Decisions

<!-- e.g.
     - 2026-08-15 T-0031 prefer X over Y for Z
       (from: whether Z should use X or Y) -->
