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
    → ≥30 un-embedded rows? spawn detached `cli.mjs embed-pending --all`
      (lock file serializes runs; embedding = Ruri v3-310m ONNX on CPU)

prompt submitted (UserPromptSubmit hook) hooks/memory-inject.mjs
    first prompt of the session → time summary + elapsed-days reminder
    every prompt → hybrid search over the last 7 days
      FTS5 (trigram) + vector (sqlite-vec cosine) → RRF fusion → time decay
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
| `<vault>/_ai/memory/memory.db` | the database — **gitignored**; conversation text is stored verbatim and may contain sensitive material |

## Setup

Run the `memory-setup` skill (or `node cli.mjs setup`) once per machine. It
installs `better-sqlite3`, `sqlite-vec`, and `@huggingface/transformers` into
`~/.workhub/memory-engine/`, downloads the embedding model
(`onnx-community/ruri-v3-310m-ONNX`, q8, ~320 MB), initializes the vault DB,
ensures the vault `.gitignore` covers it, and writes the setup marker the
hooks and the workhub app check. Re-run after a plugin update that bumps
`ENGINE_VERSION` in `lib/paths.mjs` (the marker mismatch disables the hooks
until then).

## CLI

```bash
node cli.mjs status                    # setup / DB state
node cli.mjs recall "<query>" [--days N] [--limit N] [--full]
node cli.mjs recent [--limit N]        # newest chunks, no query
node cli.mjs capture <transcript.jsonl> [--task <id>]
node cli.mjs embed-pending [--all]     # vectorize rows with embedding=NULL
```

Works from any agent (OpenCode included) or a plain terminal; only Node 20+
is assumed.
