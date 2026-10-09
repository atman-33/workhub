---
name: tree-review
description: Inspect an existing logic tree (a problem dug into causes, e.g. a mind map of why a schedule slips) for logical flaws, then, once the tree is sound, group its leaf causes into three to five major issues by asking one question at a time. Review is reported as findings; grouping is settled with the user. Use when the user has a cause tree, why-tree or mind map and wants it checked, or wants its leaves boiled down to a few issues to act on, or says 「ロジックツリーを検査して」「原因ツリーを課題にまとめたい」「末端の原因を整理して」「tree-review」.
argument-hint: "[review|group] [file, pasted tree or mind map]"
---

# tree-review

The input is a tree that already exists: a problem at the root, causes below
it. `ladder up` builds such a tree from nothing by asking; this skill takes
the finished tree and does two jobs on it.

- **review** — inspect the logic. You answer with findings.
- **group** — boil the leaf causes down to a few major issues. You ask one
  question at a time and the user decides.

Take the mode from the argument. With none, run review first and offer group
once the findings are dealt with. Read the tree in full before the first
output: a file, a mind map note, or pasted text. Keep the user's wording for
every node.

## Review

Report findings only; do not edit the tree. Each finding names the node,
quotes it, and says in one sentence what is wrong. Checks, in this order:

1. **Symptom mixed with cause.** A node that restates its parent in other
   words is not a cause ("tasks pile up late" under "tasks increase"). Ask
   what produces it.
2. **Stopped at "not done".** "We did not review X" is where a cause starts.
   Dig to why it was not done: no time, no owner, not seen as worth it.
3. **Mixed axes under one parent.** Siblings should answer the same question.
   "Why is it slow now" and "why does it not get faster" are different
   questions and belong under different parents.
4. **Loops back to the root.** A tree shows one direction, so a leaf that
   feeds the root hides a vicious circle. Name the loop explicitly:
   leaf → … → root → leaf.
5. **Fact or hypothesis.** Mark each node as observed or inferred. List the
   inferred ones as hypotheses, with what would confirm them.

Close with a short list: findings by check, then the edits you suggest in
words ("move X under Y", "split Z", "add the cause under W"). When the tree
lives in a vault mind map, say the suggested edits can be handed to
`workhub:diagram-edit`; this skill never writes the file itself.

## Group

Start from the leaves, after the review findings are fixed or set aside. Ask
one question per turn, building each from the user's last answer.

1. **Cluster.** Propose no grouping at first. Ask which leaves feel like one
   problem, and gather three to five clusters from the user's answers. When
   asked for a draft, offer one labelled `Strawman:`.
2. **Coverage.** Check that every leaf lands in a cluster. List the ones that
   float and ask where each belongs, or whether a cluster is missing.
3. **Relation.** Ask whether the clusters are parallel or one sits upstream of
   another. An upstream issue gets handled first.
4. **Naming.** Test each name for height. Too broad and it only restates the
   goal ("do better"); too narrow and it is one leaf under another name.
5. **Field test.** Ask for a fact from the user's own situation that the name
   and the grouping should explain. If a fact does not fit, change the name
   or the grouping, not the fact.

A step closes the way `ladder` closes a Level: restate in one sentence in the
user's words, ask "Is that right, or what would you change?", and move on only
on an explicit yes. Unagreed items wait in an Open list.

## Output

When group finishes, print in chat, with agreed content only. Mark each leaf
with its issue so the user can carry the labels back into the tree.

```markdown
# <Root problem>

## Issues
1. <Issue name> — <one-line scope>
   - leaves: …
2. …

**Relation:** <parallel, or A → B upstream/downstream>
**Loops:** …
**Hypotheses still open:** …

## Open
- …
```

Write a file only when asked, to the path the user names.
