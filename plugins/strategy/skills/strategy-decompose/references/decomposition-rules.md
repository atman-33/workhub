# The shape of a decomposition

## Levels

| Level | Name | Content | How to write it |
|---|---|---|---|
| 1 | Strategy | the strategy as handed down | **verbatim**; never paraphrased |
| 2 | Domain | the bundle of capabilities the strategy needs | noun + "we can …" |
| 3 | Component | what the domain is made of | noun + "… is in place" |
| 4 | **Aspect** | what you look at | noun + "… is in place" |
| 5 | **State** | what it looks like once reached | one sentence, ends in the achieved state |

Levels 4 and 5 are the point of this shape. The **aspect** says where to look;
the **state** says what good looks like there. They are a question and its answer.

## Writing a state (Level 5)

- **The subject is your own organization.** Not "the customer is satisfied" but
  "we can measure customer satisfaction"
- **End in an achieved state.** "Improve quality" and "strengthen X" are actions,
  not states
- **One state per cell.** "… and we can also …" is two rows
- **Make it observable.** "We are conscious of cost" cannot be judged. "We can
  explain", "a record exists", "it is agreed with the PO" can be

Bad → good

- "Improve quality" → "the criteria for deciding whether to release are defined"
- "Use AI" → "test cases are drafted with AI, cutting the authoring effort"
- "Understand the customer" → "we can explain the target user's attributes,
  domain knowledge and working environment"

## More than one Level 1

When the strategies are **stages of one flow** (validate → harden, discover →
deliver), keep them in **one sheet with several Level 1 rows** rather than
separate files; splitting them erases the hand-off from the structure. Put the
flow in one sentence at the top of the sheet.

A Level 1 cell may carry a **prefix** — `Strategy 1 [PoC phase: settle the spec]` —
but the strategy's own wording stays untouched.

## The two tests, run continuously

- **Necessity** — is this child required for the parent? If not, it belongs to a
  different strategy
- **Sufficiency** — if every child is achieved, is the parent achieved? If not,
  a branch is missing

The classic sufficiency failure is a branch that stops at **"understands"**.
Understanding changes nothing on its own. Push it down to "can explain",
"can decide", "a record exists".

## Failure modes worth hunting

- **Wrong phase mixed in** — an aspect that belongs outside the phase being
  decomposed (a validation-phase decomposition that carries "measure the impact
  after release"). Re-read the range Level 1 draws, every time
- **The same thing cut twice** — "we understand X" in one branch and "we know
  what is uncertain about X" in another. Either fold one into the other, or align
  the axes so the two map one-to-one
- **Level 4 and 5 are the same sentence** — the aspect split in half rather than
  decomposed. Check that the pair reads as question and answer
- **Another team's territory** — items someone else owns. Drop them, or mark them
  explicitly as reference only

## Sizing

- 4-6 domains at Level 2. More than that and the cut is too fine
- 1-3 states per aspect
- 50-120 rows overall. Past that, Level 2 is sliced too thin

## Priorities come later

Decomposing and prioritizing are **different jobs**. Weight the rows only after
the structure is settled, using your organization's situation (length of the
period, reorganizations, headcount, work already under way). Prioritize while
decomposing and the inconvenient branches never get written down.

Every priority carries a **rationale** with two halves: which part of the upper
strategy it connects to, and which part of your situation it bites on.
