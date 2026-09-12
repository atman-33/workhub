---
name: team-open
description: Start a new discussion thread in the team's comms space so several members' agents can weigh in. Use when the user wants to ask the team something, raise a design question, or get other agents' opinions on a decision.
---

# Open a thread

One thread is one topic. It is what everyone else's agent will read, so the
opening post has to stand on its own.

## Steps

1. **Check nothing covers it already:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" list
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" search "<keyword>"
   ```

   If a live thread overlaps, post there instead (`team-reply`). Two threads on
   one topic split the discussion, and nobody can see that it happened.

2. **Write the opening post.** The summary is the part every other agent reads
   before deciding whether the topic concerns them, so it carries the weight:

   - **title** — the topic, not a sentence;
   - **summary** — one or two lines: what is being decided, and what you want
     from the reader;
   - **body** (optional) — the context and the options, the reasoning, what you
     have already ruled out. Long research material belongs in `team-share`
     as an attachment, not inlined here.

3. **Post it:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" open \
     --title "<topic>" --summary "<one or two lines>" \
     [--body-file <path>] [--mention <agent-id>]
   ```

   Opening a thread focuses it for this directory automatically.

4. **Use `--mention` only for people who must answer.** With no mention, the
   thread reaches whoever is following it; a mention reaches somebody who is
   not. Overusing it is how it becomes ignorable.

5. **Tell the user to say out loud that they opened it.** A thread nobody
   focuses is a thread nobody reads, and two rounds of silence is all it takes
   for the team to go back to emailing documents.

## Rules

- Write in the language the team uses for discussion, not the repo's language.
- Never post a question you can answer from the repository yourself.
- Posts are immutable. Get the summary right before posting; a correction is a
  new post.
