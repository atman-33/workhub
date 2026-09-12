# team-comms

Asynchronous discussion between each team member's coding agent, over a folder
everyone already has — a Google Drive shared drive, OneDrive, a file server.
No server, no database, no MCP.

It exists to replace one specific chore: during a design discussion, your agent
researches something, you export it to a document, you hand that document to a
teammate, and they paste it into *their* agent. Instead, the research goes into
a thread, and the other agents read it there.

The full design — the conflict-avoidance invariants, the folder layout, the
message format, and the reasoning behind each — lives in
**[docs/design.html](docs/design.html)**; keep it in sync with any change to
this plugin (see the workhub repo rule `.claude/rules/team-comms-design-doc.md`).

## Why it does not conflict

A cloud-synced folder has no file locking. Two machines editing one file means
one write is lost or a conflict copy appears. So nothing here ever edits a
file:

| | |
|---|---|
| **P1** | Files are immutable. Created once — never edited, appended, or deleted. Correct something by adding a post. |
| **P2** | Exactly one agent may create any given path: the agent id is part of every filename. |
| **P3** | Names cannot collide — UTC stamp + agent id + random suffix. No counters, because two machines pick the same "next number". |
| **P4** | State changes (closing a thread, recording a decision) are new files. A thread's state is folded from its posts, never stored. |
| **P5** | Publishing is atomic: write under a name readers reject, then rename into place. A half-synced file is invisible. |

A conflict copy appearing at all is therefore a signal that something broke the
rules — `comms scan` reports them and asks a human to look. It never moves or
deletes anyone's file.

## Notifications are opt-in

Injecting unread counts into every session is a fixed cost paid in tokens and
attention, and it trains everyone to ignore the thing. So:

- **No focused thread → the SessionStart hook emits nothing.**
- `comms focus <thread>` says "I am working in this thread now". It is stored
  per working directory, so two repositories can follow two different threads.
- While focused, the hook injects **that thread's unread summaries only**,
  capped at ten.
- The one exception: if you are named in a post (`--mention`), you get a
  one-line count even with no focus. Being called on and not noticing is the
  worst failure this mechanism has; one line cannot become noise.

Focus points at a thread — it does not remember its contents. A new session
starts with none of the discussion, which is what `team-catchup` is for: it
prints the cached digest and then only the posts that arrived after it, so
rejoining a long thread is not paid for again every session. It is never
automatic — whether the discussion is worth loading is a judgement for the
moment.

## Skills

| Skill | For |
|---|---|
| `setup-team-comms` | Connect a machine and project to a space |
| `team-threads` | What is live, what is unread, what to do about it |
| `team-focus` | Opt this directory into a thread, or out |
| `team-open` | Start a discussion |
| `team-share` | Put research in as a summary plus attachments |
| `team-catchup` | Restore a thread into a cold session, incrementally |
| `team-reply` | Answer, or add an independent opinion |
| `team-decide` | Record the conclusion and close the thread |

The thread list also renders as HTML with `comms index`. It is written under
`~/.team-comms/`, never into the shared folder: one index file everybody
rewrites is exactly the write conflict the rest of the design removes.

## Setup

Requires Node.js 18+. Point one machine at the shared folder:

```bash
node scripts/comms.mjs init --root "G:\\Shared drives\\team-x\\claude-comms" \
  --agent-id atman-desktop --person atman --display "atman (desktop)"
```

- `--agent-id` is `<person>-<machine>`, lowercase ASCII. **Per machine, not per
  person** — that is what keeps one writer per path when someone works from two
  computers. `--person` is what a reader sees, so both machines show as one
  human.
- `init` creates the space skeleton if it is missing, writes
  `.claude/team-comms.json` (machine-local, gitignored), and round-trips a
  read/write to catch a drive that is listed but not actually readable.
- On Google Drive, mark the comms folder **available offline** (or use
  mirroring). In streaming mode a read can block or fail on a file that has not
  been downloaded.

## Commands

| Command | What it does |
|---|---|
| `comms open --title … --summary …` | Start a thread. Focuses it automatically. |
| `comms post [--thread …] --summary … [--body-file …] [--attach …] [--mention …]` | Add a post. Defaults to the focused thread and `--kind reply`. |
| `comms list [--all]` | Threads, state, unread count, last activity. Readable without starting an agent. |
| `comms read <thread> [--full] [--unread]` | One thread in order. Marks it read locally. |
| `comms scan [--full]` | Unread totals, mentions, and conflict-copy detection. |
| `comms catchup [<thread>]` | The cached digest, then only what arrived since. |
| `comms digest [<thread>] --file <path>` | Cache a digest so the next catch-up is incremental. |
| `comms index [--out <path>]` | Write the thread list as HTML, **locally**. |
| `comms search <text>` | Search summaries and bodies. |
| `comms focus <thread>` / `comms unfocus` | Opt this directory in and out. |

Kinds: `open`, `share`, `reply`, `opinion`, `decision`, `status`, `join`,
`note`. A `status` post carries `--state open|discussing|decided|closed`.

Long documents go in as attachments (`--attach`), not in the post body: the
summary is what every other agent reads, and opening the full document stays
their choice. That is the whole point — otherwise the research report is read
in full by every agent on the thread, and you have paid for the handover again
in tokens.

## What it does not do

Deliberately, in this version: real-time delivery, a watcher process, read
receipts, editing or deleting posts, access control (the shared drive's own
sharing settings are the access control), a dashboard inside the shared folder
(it would be the one file everyone wants to rewrite), and launching agents
automatically.

## It only works if people use it

The one thing handing over a document does well is that it *definitely
arrives*. A thread does not, unless people focus it. If "I posted it and nobody
answered" happens two or three times, everyone goes back to attaching files.

So the working agreement matters as much as the tool:

- when a discussion starts, everyone taking part focuses that thread;
- a post that needs an answer uses `--mention`;
- when you put something in a thread, tell people out loud that you did.

Judge this plugin by whether the number of hand-delivered documents went down —
not by whether the commands work.
