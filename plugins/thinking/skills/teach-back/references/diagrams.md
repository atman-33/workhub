# Diagrams

A small text diagram in a code block, so the user can see the structure and
sort out their own head. Ten to fifteen lines.

## When to draw

- After sorting claims (armor step 3): the cause-and-effect chain.
- When the user is tangled, or asks: a timeline, a structure, a comparison.
- At the end (armor step 10): the final chain, into the armor sheet.

## How to draw

- Start with a skeleton and leave blanks as `???`. The user fills them; the
  filled diagram holds their words.
- Mark each link with its state: `[fact]`, `[hypothesis]`, `[unverified]`.
  A weak link should show at a glance.
- Tag anything you added yourself `(AI inference)`.
- Use arrows and indentation. Skip box borders: wide characters do not align.
- Redraw after each correction so the diagram matches the latest answers.

## Cause-and-effect chain

```text
URL monitor alert fired
  ^ [fact] monitor log 21:03
response failed or slow
  ^ [hypothesis] no log checked yet  <- weak link
???  (cause X)
```

Read upward: each arrow says "because". The weakest label is the next
question.

## Timeline

```text
21:00  deploy finished        [fact]
21:03  alert fired            [fact]
21:?? ???                     [unverified]
```

## Comparison

```text
              hypothesis A      hypothesis B
explains X    yes               yes
explains Y    no                ???
checked by    log               nothing yet
```
