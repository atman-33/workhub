---
description: Constraints for the memory plugin, its engine and its tests
paths:
  - "plugins/memory/**"
---

# workhub memory engine

## SQLite: the driver holds locks you did not ask for

The engine uses `node-sqlite3-wasm`, which has no WAL, so every reader and
writer serializes on one rollback journal. Two consequences that are not
obvious from the call sites:

- **`Statement.get()` does not reset the statement.** It stops on the first
  row, so the connection keeps a SHARED read lock until the statement is
  finalized. `Db.get()` in `lib/db.mjs` therefore goes through `all()`, which
  steps to completion. Do not "optimize" it back to a raw `get()`.
- **Never hold an open handle across an `await`.** A writer can only commit
  once every reader has released SHARED, so a read followed by a slow await —
  embedding a query takes seconds — starves writers on every other session.
  T-0366 lost 180 of 193 sessions exactly this way: `buildInjection` read stats
  and then awaited the ONNX model with the lock still held.

Writes themselves are cheap (10–30ms for a handful of chunks on a real-sized
database, FTS5 trigram index included), and the busy timeout works across
processes. When a lock error shows up, suspect a reader, not contention.

## Capture must not lose a session

`lib/capture.mjs` owns the durable path: retry on a busy database, queue the
transcript when the retries run out, drain the queue on the next capture, and
record health so `cli.mjs status` and the session briefing can report it.
Anything that writes chunks goes through it. A hook may swallow an exception —
it must never swallow the data.

## Adding a file means bumping ENGINE_VERSION

`setup` short-circuits while the marker matches `ENGINE_VERSION`, so the copy
under `~/.workhub/memory-engine/engine/` is otherwise never refreshed. A new
module in `lib/` that an old copy does not carry fails to load for every
caller that uses that copy (the OpenCode plugin, a plain terminal). Bump
`ENGINE_VERSION` in `lib/paths.mjs` whenever the *set of files* changes, not
only when a dependency or the model does.

## Reflexes are not rules

The plugin injects a block telling a session how to *use* memory (search before
answering, type a decision, cite rather than paraphrase). That is deliberately
not a `.claude/rules/` file, and the distinction is worth keeping straight:

| | `.claude/rules/` | the reflex block |
|---|---|---|
| Fires | on touching a matching path | unconditionally, per session |
| Subject | the code being edited | the session's own behaviour |
| Lives in | this repository | `plugins/memory/engine/lib/reflexes.mjs` |

Memory advice scoped to a path would arrive only while editing that directory —
which is exactly when it is least relevant. Conversely, a constraint about this
repository does not belong in the reflex block: it would be paid for in every
session on the machine, including ones nowhere near this code.

It is also not a Claude Code output style, though the system prompt would be
the natural home. Only one output style can be active at a time and it is a
global choice, so taking that slot would put memory in competition with
whatever the owner wants their sessions to sound like — a bad trade for a
plugin that is meant to be switchable on its own. The full text goes in the
SessionStart brief and a single line rides each prompt, which survives
compaction at a cost of one line per turn.

## Testing against real SQLite

`node-sqlite3-wasm` **does not initialize under Vite's module runner**: a
vitest file that imports `lib/deps.mjs` or `lib/db.mjs` at module scope hangs
before collection, with no error. Keep vitest files free of those imports and
drive real-database checks from a script run with `spawnSync(process.execPath,
…)` — which is what a lock check needs anyway, since it takes two connections.

Inside such a script:

- resolve the driver with `createRequire(join(ENGINE_HOME, "package.json"))` —
  it is installed into ENGINE_HOME by `memory-setup`, never into the
  repository;
- import engine modules through `pathToFileURL()`; a bare Windows absolute
  path raises `ERR_UNSUPPORTED_ESM_URL_SCHEME`;
- gate the test on the driver actually being installed
  (`describe.runIf(...)`), so CI, where setup has not run, skips it instead of
  failing.

Set `WORKHUB_ENGINE_HOME` to a temporary directory in tests: capture state and
the retry queue live there, and a test run must not touch the real install's
queue.
