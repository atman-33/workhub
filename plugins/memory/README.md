# memory

Long-term memory for agent sessions on a workhub vault. Every session's Q&A
pairs are captured into a vault-local SQLite database, and a new session
receives a time summary plus the past conversations relevant to its prompt.
Fully local: a Japanese-capable embedding model (Ruri v3) runs on the CPU,
nothing leaves the machine, and no LLM is called.

Split out of the `workhub` plugin in T-0367. It was the one part of that
plugin with a per-machine setup step and a database of its own, and a vault
that wants neither should not have to give up the task board to say so.

## Contents

| Path | What |
|---|---|
| `hooks/capture.mjs` | Stop hook — writes the session's chunks |
| `hooks/inject.mjs` | UserPromptSubmit hook — injects the time summary and relevant memories |
| `engine/` | The engine itself: CLI, storage, retrieval, embedding, setup, doctor. See `engine/README.md` |
| `skills/memory-setup` | One-time machine setup |
| `skills/memory-recall` | Explicit search over past conversations |
| `skills/memory-doctor` | Is memory actually working? |
| `lib/` | The two small pieces copied from the `workhub` plugin (see below) |

## Setup

```bash
/memory-setup
```

Once per machine. Until it succeeds every hook is a **silent no-op** — that is
deliberate, because a hook must never break a session, and it is also why
`memory-doctor` exists.

```bash
/memory-doctor
```

## What it depends on

The plugin reads three things the `workhub` app and plugin own. All three are
**data contracts**, not imports: Claude Code installs every plugin into a cache
keyed by that plugin's version, so a relative path out of this tree resolves in
the repository and breaks on an installed copy.

| Contract | Owner | Used for |
|---|---|---|
| `~/.workhub/config.json` → `vault_path`, `settings.memory_claude_code`, `settings.memory_opencode` | the workhub app | finding the vault, and the per-agent on/off switches |
| `<vault>/_ai/memory/sessions/<key>.json` | `workhub`'s `task-cli start` | tagging a session's chunks with the task that session is working |
| `<vault>/_ai/memory/memory.db` | this plugin | the database itself, gitignored |

Two files under `lib/` are deliberate copies of the read paths for the second
contract (`session-marker-read.mjs`) and of the hook payload reader
(`hook-input.mjs`). `copies.test.mjs` pins both against the originals in
`plugins/workhub/`, so the contract cannot drift silently — a copy that reads
markers from a path `task-cli` no longer writes to would file every session
under no task at all, without saying anything.

## OpenCode

OpenCode sessions get the same behaviour through the vault's
`.opencode/plugins/memory-plugin.ts`, which shells out to the version-stable
engine copy `setup` installs under `~/.workhub/memory-engine/engine/`. It must
not depend on this plugin's directory, which is why that copy exists.

## Health

Capture is best-effort in the sense that it never breaks a session — never in
the sense that it may quietly lose one. It used to be both; see
`engine/README.md` under **Durability** for what changed and why.

- `cli.mjs status` — the short form: setup, database counts, last capture.
- `cli.mjs doctor` — every check, each failure with the action that fixes it.
  Exits 1 on failure so a script can act on it.
