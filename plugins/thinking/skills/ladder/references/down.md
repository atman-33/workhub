# ladder down — from a concept to observable conditions

Starts from an abstract concept the user holds ("strategy", "the organisation",
"AI adoption") and ends at conditions someone could check. The concept means
what it means *to the user, in their context* — the dictionary sense is only a
prompt for them to disagree with.

## Levels

| # | Level | Question it answers | Closed when |
|---|---|---|---|
| 1 | Concept | Which concept, in which context? | the concept and the context it lives in are named |
| 2 | Definition | What does it mean here? | one sentence the user would put in front of a colleague |
| 3 | Purpose | What is it for — what goes wrong without it? | the reason it exists, beyond restating the definition |
| 4 | Desired state | When it works, what is true? | a state, not an activity ("reviews finish within a day", not "improve reviews") |
| 5 | Components | Which parts make up that state? | a set the user judges complete for now, each part distinct from the others |
| 6 | Component states | For each part, what is true when it works? | one state per component, same test as Level 4 |
| 7 | Observable conditions | How would someone see that each state holds? | each state has at least one sign a third party could check |

Levels 5–7 repeat per component. Take one component to Level 7 before
starting the next, and keep the rest in the ledger's Next list.

## Writing states

A state describes what is true, and can be observed. Push for an observer and
an observation: who could tell, and by looking at what. "The team is
aligned" becomes "anyone on the team gives the same top three priorities when
asked". When the user answers with an action, ask what will be true once it
is done.

## Output

```markdown
# <Concept>

**Context:** …
**Definition:** …
**Purpose:** …
**Desired state:** …

## Decomposition

### <Component 1>
- **State:** …
- **Observable conditions:**
  - …

### <Component 2>
…

## Open
- …
```
