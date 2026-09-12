---
name: team-catchup
description: Restore a team-comms thread's discussion into this session - the cached digest plus whatever arrived since - and save an updated digest. Use when starting work in a thread whose history this session does not have, after focusing one, or when the user asks what has been said.
---

# Catch up on a thread

A session knows nothing about a thread it was not part of. Focus points at a
thread; it does not remember its contents. This skill fills that gap — and it
is **the only part of team-comms that spends a meaningful number of tokens**,
so it reads incrementally and only when asked.

## Steps

1. **Pull what this session is missing:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" catchup [<thread-id>]
   ```

   Defaults to the focused thread. It prints the cached digest first, then only
   the posts that arrived after it. With no digest yet, it prints the whole
   thread and says so.

2. **Read summaries first.** Open a post in full (`--full`) or an attachment
   only where the summary is not enough to act on. Reading everything defeats
   the design — the summaries exist so you do not have to.

3. **Brief the user in a few lines**: where the discussion stands, what is
   unresolved, who is waiting on what, and whether a decision has been
   recorded. If the tool reports **more than one decision**, say so — sync
   delay means two people can each believe theirs was the last word, and
   picking by timestamp would hide that. A person decides which stands.

4. **Save an updated digest** so the next session is cheap:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" digest [<thread-id>] --file <path>
   ```

   Write 5–15 lines: the question, the positions and who holds them, what has
   been settled, what is open. Write it for a session that has never seen the
   thread — that is exactly who will read it.

5. **If the thread is long and the user is joining cold**, `--all` re-reads
   everything from the start, ignoring the digest. Use it when the digest was
   written for a different purpose, not routinely.

## Rules

- Never run this automatically at session start. Whether the discussion is
  worth loading is a judgement for the moment, which is why the hook injects
  summaries and stops there.
- The digest is your reading of the thread, cached on this machine. It is never
  written into the shared space — it is not a fact about the thread, and it
  would become one more file several people want to rewrite.
- Do not treat the digest as the source of truth when it matters: the posts are.
