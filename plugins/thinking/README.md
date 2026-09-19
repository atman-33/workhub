# thinking

Skills that ask instead of answer. Each one puts a single question to you at a
time, so the understanding or the structure ends up in your head rather than
in a summary the model wrote.

## Install

Install at user scope so it is available from any working directory:

```
claude plugin install thinking@workhub-marketplace
```

## Skills

| Skill | For |
|---|---|
| `teach-back` | Understanding a document well enough to explain it to someone else. Quizzes you on definitions, numbers, evidence, background and scope, and keeps the document's own gaps apart from yours. |
| `ladder` | Thinking a concept or a problem through, one agreed level at a time. `down` breaks a concept into definition, purpose, desired state, components and observable conditions; `up` climbs from a symptom through facts and causes to the purpose and the state worth aiming for. |

Both keep their record in chat and write a file only when asked. No scripts,
no vault or project-context dependency.

## How they differ from neighbours

- `grilling` (`claude-tooling`) questions the *decisions* in a plan and offers
  a recommended answer to each. These skills question your *understanding*,
  and hold back the answer.
- `strategy-decompose` (`strategy`) starts from a strategy document handed
  down from above, keeps its wording, audits the result and outputs an xlsx.
  `ladder down` starts from a concept in your own head and settles it one
  level at a time.
- `strategist` (`workhub`) reads the vault's `strategy/` folder. These skills
  read nothing but what you give them.

## Later

A third `ladder` direction, `gap` (current state → gap → actions → outcomes),
is a candidate once `down` and `up` have seen real use.

## Attribution

`teach-back` is a rewrite that borrows ideas from four MIT-licensed skills; no
upstream text or scripts are bundled. See [NOTICE.md](NOTICE.md).
