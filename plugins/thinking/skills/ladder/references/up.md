# ladder up — from a symptom to the state worth aiming for

Starts from something going wrong on the ground ("sprints never finish",
"reviews stall") and climbs past its causes to the purpose the work serves and
the state worth aiming for. The finish line is a better problem statement,
which is further than a root cause.

## Levels

| # | Level | Question it answers | Closed when |
|---|---|---|---|
| 1 | Symptom | What is going wrong, in the user's words? | one symptom, as the user would report it |
| 2 | Facts | What has actually been observed — when, how often, by whom? | observations only, each separated from its interpretation |
| 3 | Direct cause | What produces those facts right now? | a cause the facts support |
| 4 | Structural cause | What keeps producing that cause? | a cause in how the work is set up — process, incentives, sizing — rather than one person or one event |
| 5 | Background | What changed, or what assumption no longer holds? | the premise the structure was built on, and why it no longer fits |
| 6 | Purpose | What was this work meant to achieve in the first place? | the aim, stated independently of the current way of working |
| 7 | Desired state | Given that purpose, what should be true now? | a state, not an activity, that removes the symptom as a side effect |

Example path: sprints overrun → reviews are the bottleneck → each review is
large → AI has made the unit of development bigger → sprint and backlog design
still assume the old unit size → development exists to ship value in small,
verifiable steps → a process whose unit fits AI-sized work.

## How this differs from five whys

- **Facts before causes.** Level 2 keeps what was seen apart from what it is
  thought to mean. When an answer mixes the two, split it and ask which part
  was observed.
- **One branch at a time.** When a Level has more than one plausible cause,
  ask the user to pick the one to follow; the others go to the ledger's Open
  list, with the Level they branched from.
- **The climb continues past the cause.** Levels 6–7 turn the cause into a
  purpose and a target, which is what makes the result actionable.

## Handing over to down

Once Level 7 is agreed, offer to continue with `ladder down` on the desired
state, which decomposes it into components and observable conditions.

## Output

```markdown
# <Symptom>

**Facts:**
- …
**Direct cause:** …
**Structural cause:** …
**Background:** …
**Purpose:** …
**Desired state:** …

## Branches not followed
- L<n>: …

## Open
- …
```
