---
name: teach-back
description: Quiz the user on a document, one question at a time, until they can explain it to someone else — definitions, numbers, evidence, background, scope — and log the document's own gaps separately. Use when the user wants to understand material rather than have it summarised, is preparing to explain or present a document, or says 「理解できるまで質問して」「説明できるようになりたい」「この資料を叩き込みたい」「teach-back」.
argument-hint: "[file, folder, URL, image or pasted text]"
---

# teach-back

The user leaves able to explain the material in their own words. You get them
there by asking, never by summarising: every answer on the record is theirs.

The measure is a **teach-back** — the user explaining the material back, as if
to the person they will face. Your questions are the rehearsal for that person.

## Steps

1. **Read the material.** Files, folders, URLs, images and pasted text. Read
   pdf / pptx / xlsx / docx through their skills when installed; view images
   with Read. Done when you can point to where each claim in it lives.
2. **Ask for the audience.** One question: who will they explain this to, and
   what for. The answer sets how deep to dig and which axes matter most. Done
   when you have a named listener and a purpose.
3. **Map the questions** (large or multi-file material only). Show 5–8
   questions the user should be able to answer, most important first, and
   start from the one or two the rest stand on. Done when the user has seen
   the map.
4. **Get the first teach-back.** Ask for the whole thing in three sentences,
   without jargon: what is this material and what does it say. Aim every later
   question at what this answer left thin.
5. **Question, one at a time.** Pick from the axes below, in order of what
   matters for the stated audience. Loop until every mapped question — or,
   without a map, every axis that bears on the material — has a sound answer
   from the user or sits on the gap list.
6. **Close with recall.** Ask for the teach-back again, now in full. Their
   words, not your summary.
7. **Hand over the record** in chat (format below). Save it to a file only
   when asked — to the path the user names, otherwise beside the material.

## Question axes

| Axis | Probe |
|---|---|
| Definition | What does this term mean *in this document* — what exactly changes when it says "optimise"? |
| Number | Source, denominator, period, unit, baseline. "30% better — at what, compared with what?" |
| Evidence | Why can it say that? Does another explanation fit the same facts? |
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
- **Mark inference as inference.** Intent and background the material does
  not state are hypotheses: offer them labelled as such, with "the document
  does not say".

## Record

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
