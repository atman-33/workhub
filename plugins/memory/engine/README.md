# workhub memory engine

Long-term memory for AI agent sessions on a workhub vault: every session's
Q&A pairs are stored in a vault-local SQLite database, and new sessions get a
time summary plus past conversations relevant to the current prompt. Fully
local — no cloud services, no LLM calls. The design follows
[sui-memory](https://github.com/sakuranjunkie-staff/sui-memory) and
[kizami](https://github.com/sakuranjunkie-staff/kizami), reimplemented in
Node for the workhub plugin ecosystem.

## How it works

```
session ends (Stop hook, async)          hooks/memory-capture.mjs
    transcript .jsonl → Q&A chunks (lib/chunker.mjs)
    → text-only insert into SQLite (embedding=NULL, FTS5 updated instantly)
      retried on a busy database, queued for the next capture if it stays busy
      (lib/capture.mjs)
    → ≥30 un-embedded rows? spawn detached `cli.mjs embed-pending --all`
      (lock file serializes runs; embedding = Ruri v3-310m ONNX on CPU)

prompt submitted (UserPromptSubmit hook) hooks/memory-inject.mjs
    first prompt of the session → time summary + elapsed-days reminder
    every prompt → hybrid search over the last 7 days
      FTS5 (trigram) + vector (cosine, computed in JS) → RRF fusion → time decay
      relevance-gated (cosine distance ≤ 0.65, FTS hits always pass), max 5
```

Both hooks are silent no-ops until setup has run on the machine, so sessions
never break on an un-provisioned install.

## OpenCode

OpenCode sessions get the same behavior through the vault's
`.opencode/plugins/memory-plugin.ts` (shipped in `vault-template/`): it
prepends the `cli.mjs inject` output to each user message (`chat.message`
hook) and feeds the session's messages to `cli.mjs capture-json` on
`session.idle`. Pairing, noise filtering, search, and embedding all run
engine-side, so the two agents stay behaviorally aligned. The plugin calls
the version-stable engine copy that setup installs under
`~/.workhub/memory-engine/engine/` (it must not depend on the versioned
Claude plugin cache path).

Per-agent switches live in the workhub app settings
(`~/.workhub/config.json` → `settings.memory_claude_code` /
`settings.memory_opencode`, both default true); the Claude hooks and the
OpenCode plugin check them on every run.

## Layout

| Where | What |
|---|---|
| this directory | engine source (ESM), shipped with the plugin |
| `~/.workhub/memory-engine/` | npm deps, model cache, `.setup-version` marker (per machine, survives plugin updates) |
| `<vault>/_ai/state/memory.db` | the database — **gitignored**; conversation text is stored verbatim and may contain sensitive material |

A vault that has not run the workhub vault-upgrade skill's migration 002 still
has its database under the pre-T-0390 `_ai/memory/`. As of T-0392 nothing
falls back there any more, so `legacyDbStranded()` in `lib/paths.mjs` detects
that case and every DB-opening hook/CLI command no-ops instead of starting a
second, empty database at `_ai/state/memory.db`.

## Setup

Run the `memory-setup` skill (or `node cli.mjs setup`) once per machine. It
installs `node-sqlite3-wasm` and `@huggingface/transformers` into
`~/.workhub/memory-engine/`, downloads the embedding model
(`onnx-community/ruri-v3-310m-ONNX`, q8, ~320 MB), initializes the vault DB,
ensures the vault `.gitignore` covers it, and writes the setup marker the
hooks and the workhub app check. Re-run after a plugin update that bumps
`ENGINE_VERSION` in `lib/paths.mjs` (the marker mismatch disables the hooks
until then).

No dependency compiles from source, so setup never needs a C/C++ toolchain:
SQLite comes from the WebAssembly build (`node-sqlite3-wasm`) instead of a
native binding, and `onnxruntime-node` ships its binaries inside the package.
The trade-offs of the WASM build are that WAL is unavailable — the two hooks
serialize on the write lock via `busy_timeout` — and that loadable extensions
cannot be used, which is why cosine distance is computed in JavaScript rather
than by `sqlite-vec`. Embeddings stay a plain `BLOB` column either way, so the
table schema is unchanged.

A database written by engine version 1 is in WAL mode, which the WASM build
refuses to open at all. `openDb()` therefore converts it back to a rollback
journal on first use (via Node's built-in `node:sqlite`, falling back to a
header rewrite when no `-wal` file is pending); no data is touched and the
conversion happens once.

## CLI

```bash
node cli.mjs status                    # setup / DB state
node cli.mjs recall "<query>" [--days N] [--limit N] [--full]
node cli.mjs recent [--limit N]        # newest chunks, no query
node cli.mjs capture <transcript.jsonl> [--task <id>]
node cli.mjs capture-retry             # re-try transcripts a busy DB deferred
node cli.mjs embed-pending [--all]     # vectorize rows with embedding=NULL
```

Works from any agent (OpenCode included) or a plain terminal; only Node 20+
is assumed.

## Durability

Capture is best-effort in the sense that it never breaks a session — but not
in the sense that it may quietly lose one. It used to be both: the Stop hook
swallowed every exception, so when the database was busy the session's chunks
were gone and nothing said so. 180 of 193 sessions were lost that way over
six weeks before anyone looked (T-0366).

Three things keep that from recurring.

**The contention is gone.** The WASM driver stops a single-row `get()` on the
first row and leaves the statement un-reset, so the connection held a SHARED
read lock until it was closed. `buildInjection` read stats that way and then
awaited the embedding model for seconds, so parallel sessions starved the
writer past the busy timeout. `Statement.get()` now steps to completion, which
resets the statement and releases the lock immediately.

**A busy database costs a delay, not a session.** `lib/capture.mjs` retries
with backoff, and a transcript that still cannot be written is appended to
`~/.workhub/memory-engine/capture-queue.jsonl` and re-tried by the next
capture (or by `cli.mjs capture-retry`). Entries drop out when their
transcript is deleted or after 14 days.

**A stalled capture says so.** Every attempt updates
`~/.workhub/memory-engine/capture-state.json`, which `cli.mjs status` reports
and which adds a warning line to the first injected block of a session. A
memory that has quietly stopped recording otherwise looks exactly like a
memory with nothing to say.

`WORKHUB_ENGINE_HOME` overrides the engine home for both files, so a test
never shares a queue with the real install.
