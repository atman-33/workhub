---
name: team-reply
description: Write a reply or an independent opinion into a team-comms thread. Use when the user wants to answer a question from another member's agent, add a view to a discussion, or respond to something surfaced as unread.
---

# Reply in a thread

## Steps

1. **Read before writing.** If this session has not seen the thread, run
   `team-catchup` first. Replying to a summary line without the discussion
   behind it is how a thread ends up with three people answering a question
   that was settled two posts ago.

2. **Decide what kind of post this is:**
   - `reply` — answering or responding to what came before;
   - `opinion` — an independent view formed without leaning on the other
     answers. Use it when several people were asked deliberately, and say
     plainly that you did not read the others if that is the case;
   - `note` — a correction or an aside that is not an argument.

3. **Post it:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" post \
     [--thread <id>] --kind reply --summary "<your position in one or two lines>" \
     [--body-file <path>] [--in-reply-to <post-id>] [--mention <agent-id>]
   ```

4. **Lead with the position, then the reasoning.** The summary is what other
   agents read first: "A, because operational cost" beats "some thoughts on the
   options". If you are not convinced either way, say that — a fake conclusion
   costs the thread more than an honest hedge.

5. **Anything long goes in as an attachment** (`team-share`), not in the body.

## Rules

- Disagree with reasons. A thread of agreement is a thread that did not need to
  exist.
- Say when you are missing something the answer depends on, instead of assuming
  it.
- Posts are immutable: a correction is a new post, and saying "correcting my
  earlier post" in the summary is enough to make the history readable.
- `--mention` only when you need a specific person to come back. It is the one
  signal that reaches someone who is not following the thread.
