---
name: memory-doctor
description: Check whether long-term memory is actually working on this machine - setup, engine copy, model cache, vault, database, and whether capture is still recording. Use when memory looks stale or empty, when sessions stop being remembered, before reporting a memory bug, or when the user asks to check/diagnose memory.
---

# memory-doctor — Is memory actually working?

`memory-recall` answers "what do I remember". This answers "am I still
remembering at all".

It exists because the engine is deliberately silent: every hook swallows its
own errors so a session is never broken by a memory problem. That is the right
trade for a hook and the wrong one for the owner — capture failed on 180 of 193
sessions for six weeks before anyone looked (T-0366). Nothing surfaces unless
something goes looking.

## Steps

1. **Run the check.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" doctor
   ```

   Every line is `ok` / `WARN` / `FAIL`, and each problem carries the action
   that fixes it. The command exits 1 only on `FAIL`, so a warning does not
   fail a script that runs it.

2. **Report what it found, in the user's language.** Lead with the verdict —
   working, working with a caveat, or not working — then the lines that are
   not `ok`. Do not paste the whole report when everything passes; say it
   passed and give the memory and session counts.

3. **Act on the common ones**, rather than only relaying them:

   | Line | What it means | What to do |
   |---|---|---|
   | `FAIL setup` | No marker, or it predates this engine version | Run the `memory-setup` skill. Until it succeeds every hook is a no-op |
   | `FAIL engine copy` | `~/.workhub/memory-engine/engine/` is missing or stale | Run `memory-setup`. OpenCode calls that copy, not the plugin |
   | `FAIL database` | The file cannot be opened | Check it is not held open elsewhere; report the message verbatim |
   | `FAIL capture failures` | Writes are failing in a row | Read `lastError`. Once the cause is gone, `cli.mjs capture-retry` |
   | `WARN capture queue` | Sessions written to the retry queue | `cli.mjs capture-retry`, or just start another session — capture drains it |
   | `WARN capture` (never / N days) | Nothing has been recorded recently | If the user has been working in this vault since, capture is failing — not idle |
   | `WARN embeddings` | A backlog of un-embedded rows | `cli.mjs embed-pending --all` and watch for an error; search is keyword-only until it clears |
   | `WARN opencode log` | The OpenCode side logged a problem | Read `<vault>/.opencode/plugins/logs/memory.log` — it is only written when something went wrong |

4. **Do not paper over a failure.** If a check fails and the fix does not work,
   say so plainly and stop. A memory that reports itself healthy while
   recording nothing is the exact failure this skill exists to prevent.

## Notes

- Safe to run any time: every check is read-only.
- It works on a broken install by design — the setup, engine-copy and model
  checks run before anything that needs the database, so "the dependencies are
  missing" is reported rather than thrown.
- `cli.mjs status` is the short form (setup, database, last capture). Use it
  when you only need the counts.
