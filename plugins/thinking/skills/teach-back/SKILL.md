---
name: teach-back
description: Quiz the user on a document, one question at a time, until they can explain it to someone else — definitions, numbers, evidence, background, scope — and log the document's own gaps separately. For material that makes causal claims or rests on hypotheses (incident reports, post-mortems, proposals), also runs armor mode: sorts fact from hypothesis, checks the cause-and-effect chain, cross-examines it, and hands over what to assert, hedge and leave out. Use when the user wants to understand material rather than have it summarised, is preparing to explain, report or present a document, or says 「理解できるまで質問して」「説明できるようになりたい」「この資料を叩き込みたい」「理論武装したい」「裏取りできているか確認したい」「teach-back」.
argument-hint: "[file, folder, URL, image or pasted text]"
---

# teach-back

The user leaves able to explain the material in their own words. You get them
there by asking, never by summarising: every answer on the record is theirs.

The measure is a **teach-back** — the user explaining the material back, as if
to the person they will face. Your questions are the rehearsal for that person.

## Armor mode

Material that makes causal claims or rests on hypotheses needs more than
understanding: the user must be able to defend each claim. Armor mode adds
steps 3, 7 and 8 below. It applies when the material asserts that A caused B,
states a hypothesis, or is a report the user will stand behind. Plain
reference material runs without it.

Armor means each claim is asserted at the strength its evidence supports. You
cannot verify outside facts; the user's labels and their stated checks are the
evidence. Say "I have not verified this" for whatever you could not check.

## Steps

1. **Read the material.** Files, folders, URLs, images and pasted text. Read
   pdf / pptx / xlsx / docx through their skills when installed; view images
   with Read. Done when you can point to where each claim in it lives.
2. **Ask for the audience.** One question: who will they explain this to, what
   for, and who wrote the material (the user, an AI, someone else). The answer
   sets how deep to dig and which axes matter most; a user who wrote or is
   reporting the material owns its gaps. Done when you have a named listener,
   a purpose and a writer.
3. **Sort the claims** (armor mode). List the material's claims, causal ones
   first, and have the user label each *fact* (observed: log, metric,
   repro, source), *hypothesis* (inferred) or *unknown*, naming where they
   checked it. Draw the cause-and-effect chain with those labels
   ([references/diagrams.md](references/diagrams.md)). Done when every causal
   claim carries a label and a place it was checked.
4. **Map the questions** (large or multi-file material only). Show 5–8
   questions the user should be able to answer, most important first, and
   start from the one or two the rest stand on. Done when the user has seen
   the map.
5. **Get the first teach-back.** Ask for the whole thing in three sentences,
   without jargon: what is this material and what does it say. Aim every later
   question at what this answer left thin.
6. **Question, one at a time.** Pick from the axes below, in order of what
   matters for the stated audience. Loop until every mapped question — or,
   without a map, every axis that bears on the material — has a sound answer
   from the user or sits on the gap list.
7. **Settle each weak spot** (armor mode). For every hypothesis, unknown and
   unsound answer, the user picks one: *verify* now (you offer the cheapest
   check), *state as hypothesis* (you offer wording such as "possible cause;
   confirming by X"), or *leave out*. Done when no weak spot is left without a
   choice.
8. **Cross-examine** (armor mode). Play a sceptical listener and attack the
   chain one link at a time, using
   [references/cross-examine.md](references/cross-examine.md). Include the
   questions the listener will most likely ask. Done when every link has
   survived an attack or has a settled choice from step 7.
9. **Close with recall.** Ask for the teach-back again, now in full. Their
   words, not your summary.
10. **Hand over the record** in chat (formats below). Save it to a file only
    when asked — to the path the user names, otherwise beside the material.

## Question axes

| Axis | Probe |
|---|---|
| Definition | What does this term mean *in this document* — what exactly changes when it says "optimise"? |
| Number | Source, denominator, period, unit, baseline. "30% better — at what, compared with what?" |
| Evidence | Where does the claim come from — which log, source or observation? Does another explanation fit the same facts? |
| Cause | Did A come before B? What mechanism links them? Without A, would B still have happened? Does A explain the timing, the scope and the "why now"? |
| Verification | Fact or hypothesis? What confirmed it — log, repro, metric, a second person? If nothing yet, what is the cheapest check? |
| Background | Why was this written now? What was the writer trying to avoid? |
| Scope | What does it leave out? If assumption X breaks, what breaks with it? |
| Implication | So what happens next — what has to be decided? |
| Figure | What does this chart show, and what does it not show? |

## How to question

- **Anchor to the material.** Every correction and every "that's right" cites
  the passage it rests on.
- **Probe before correcting.** A wrong or vague answer gets one follow-up
  first: a counterexample, a what-if, or "say it without that word". Still
  off, show the passage, correct in a sentence or two, and move on.
- **Break hollow fluency.** An answer that sounds right but only reuses the
  document's own terms gets the same follow-up: ask for it in plain words or
  for a concrete instance.
- **Judge the reasoning, not the wording.** Confirm a sound answer at once,
  plainly, then dig one level deeper.
- **Shrink the question when the user is stuck.** After three questions with
  no progress, give a handhold — a concrete example, or half the answer.
- **Switch when asked.** "Just tell me" gets the answer, with its passage.
- **Log doc gaps.** A question the material itself cannot answer is a
  *doc gap*, not the user's miss: say so, put it on the gap list and move on.
  AI-written material often carries abstract words with nothing behind them —
  this list is where that surfaces.
- **Mark inference as inference.** Intent, background and causes the material
  does not state are hypotheses: offer them labelled as such, with "the
  document does not say".
- **Draw to think.** When the structure is tangled — a chain of causes, a
  timeline, a comparison — or the user asks, draw a small text diagram
  ([references/diagrams.md](references/diagrams.md)).

## Record

Plain mode:

```markdown
## teach-back: <material>
Audience: <who> — <for what>

### Solid
- <point the user explained soundly>

### Weak
- <point> — <what was missing> (see <passage>)

### Doc gaps
- <question the material does not answer> — ask <the writer>

### Likely questions
- Q: <what the listener will probably ask>
  A: <the user's own answer, as they gave it>
```

Armor mode replaces it with the armor sheet, one page the user can carry in:

```markdown
## Armor sheet: <material>
Audience: <who> — <for what>

### Assert (evidence)
- <claim> — <where it was checked>

### State as hypothesis (wording, check planned)
- <claim> — "<wording>"; confirm by <check>

### Leave out
- <claim> — <why it is unconfirmed>

### Cause-and-effect chain
<diagram with fact / hypothesis / unverified labels>

### Likely questions
- Q: <question> — A: <the user's answer> — ready | needs prep

### Open
- <check still to run, or question for the writer>
```
