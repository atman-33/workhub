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
| `hooks/brief.mjs` | SessionStart hook — what the session is told before its first prompt |
| `hooks/checkpoint.mjs` | PreCompact hook — writes this thread's checkpoint before the context goes |
| `hooks/capture.mjs` | Stop hook — writes the session's chunks |
| `hooks/inject.mjs` | UserPromptSubmit hook — the past conversations relevant to this prompt |
| `engine/` | The engine itself: CLI, storage, retrieval, embedding, setup, doctor. See `engine/README.md` |
| `skills/memory-setup` | One-time machine setup |
| `skills/memory-recall` | Explicit search over past conversations |
| `skills/memory-doctor` | Is memory actually working? |
| `skills/memory-reflect` | Promote what a session learned into durable notes |
| `skills/memory-tidy` | Forgetting, on purpose: caps, merges, archiving |
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
| `<vault>/_ai/state/sessions/<key>.json` (`_ai/memory/` on a vault not yet migrated, T-0390) | `workhub`'s `task-cli start` | tagging a session's chunks with the task that session is working |
| `<vault>/_ai/state/memory.db` (`_ai/memory/` on a vault not yet migrated, T-0390) | this plugin | the database itself, gitignored |

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

## How a session uses it

Four moments, each doing one thing:

| When | What |
|---|---|
| **SessionStart** | The brief: open decisions and live threads, asked for by `type`/`status` — structurally, not by similarity. Plus a warning when capture has stopped |
| **every prompt** | The past conversations relevant to *this* prompt, from the verbatim layer |
| **PreCompact** | A checkpoint for this thread, before the context is lost |
| **Stop** | The session's chunks into the database |

The brief and the checkpoint read and write `memory/` — Markdown, in git. The
prompt injection and the capture use the database, which is derived and
gitignored. That split is the design: what makes the *next* session better is
a promoted fact, and a promoted fact has to survive a machine.

**The reflexes** are what get any of this read. A store nobody queries is the
same as no store, and whether memory gets consulted otherwise depends on
whether the agent happens to think of it — which, deep in a session about
something else, it does not. The full text rides the SessionStart brief and one
line rides each prompt; `memory/identity/writing.md` in the vault is the owner's own
standard for how notes are written, and the reflexes defer to it when it
exists. Not an output style (only one can be active, and it is a global
choice), not a `.claude/rules/` file (those are path-scoped and about the code,
not the session) — see `.claude/rules/memory-engine.md` for that boundary.

Promotion itself is deliberate (`memory-reflect`), and so is forgetting
(`memory-tidy`). The line between what happens on its own and what is proposed
is reversibility, not importance: writing a new note and archiving an old one
are both undoable, so they need no permission; rewriting one, merging two, or
touching `identity/` are not, so they are proposed. **Everything done without
asking is reported** — something that changes the record silently is
indistinguishable from something that is broken.

## Health

Capture is best-effort in the sense that it never breaks a session — never in
the sense that it may quietly lose one. It used to be both; see
`engine/README.md` under **Durability** for what changed and why.

- `cli.mjs status` — the short form: setup, database counts, last capture.
- `cli.mjs doctor` — every check, each failure with the action that fixes it.
  Exits 1 on failure so a script can act on it.
