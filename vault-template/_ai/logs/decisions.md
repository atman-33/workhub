---
title: Decisions log
type: log
tags:
  - log
---

# Decisions log

Every judgement an agent made *instead of* asking the owner, one line each.
The `secretary` subagent appends here when it answers DECIDE, and reads the
same lines back as precedent on later questions.

This is an audit trail, not a policy, and it is the agents' own log — the calls
the *owner* settles go to `profile/decision-log.md` instead. When a line here
turns out to be wrong, the fix is to correct `profile/decision-policy.md` — that
is what agents judge from. When a line keeps recurring, it has become a standing
rule and belongs in the policy's `## Preferences` or `## Promoted rules`.

Format: `- <date> <task-id> [DECIDE] <choice> (basis: <policy section>)`

<!-- e.g.
     - 2026-08-15 T-0042 [DECIDE] split the helper into its own module (basis: Proceed without asking / implementation detail)
-->
