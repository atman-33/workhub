---
name: herdr
description: "Control herdr from inside it. Manage workspaces and tabs, split panes, spawn agents, read output, and wait for state changes — all via CLI commands that talk to the running herdr instance over a local unix socket. Use when running inside herdr (HERDR_ENV=1)."
compatibility: Requires the `herdr` CLI on PATH and running inside a herdr-managed pane (HERDR_ENV=1).
---

# herdr — agent skill

before using this skill, check that `HERDR_ENV=1`. if it is not set to `1`, say you are not running inside a herdr-managed pane and stop. do not inspect or control the focused herdr pane from outside herdr.

you are running inside herdr, a terminal-native agent multiplexer. herdr gives you workspaces, tabs, and panes — each pane is a real terminal with its own shell, agent, server, or log stream — and you can control all of it from the cli.

this means you can:

- see what other panes and agents are doing
- create tabs for separate subcontexts inside one workspace
- split panes and run commands in them
- start servers, watch logs, and run tests in sibling panes
- wait for specific output before continuing
- wait for another agent to finish
- spawn more agent instances

the `herdr` binary is available in your PATH. its workspace, tab, pane, and wait commands talk to the running herdr instance over a local unix socket.

## concepts

**workspaces** are project contexts. each workspace has one or more tabs. unless manually renamed, a workspace's label follows the first tab's root pane — usually the repo name, otherwise the root pane's current folder name.

**tabs** are subcontexts inside a workspace. each tab has one or more panes.

**panes** are terminal splits inside a tab. each pane runs its own process — a shell, an agent, a server, anything.

**agent status** is detected automatically by herdr. the api exposes one public field for it:

- `agent_status` — `idle`, `working`, `blocked`, `done`, `unknown`

`done` means the agent finished, but you have not looked at that finished pane yet.

plain shells still exist as panes, but herdr's sidebar agent section intentionally focuses on detected agents rather than listing every shell.

**ids** — workspace ids look like `1`, `2`. tab ids look like `1:1`, `1:2`, `2:1`. pane ids look like `1-1`, `1-2`, `2-1`. these are compact public ids for the current live session.

important: ids can compact when tabs, panes, or workspaces are closed. do not treat them as durable ids. re-read ids from `workspace list`, `tab list`, `pane list`, or create/split responses when you need a current id. do not guess that an older `1-3` is still the same pane later.

## discover yourself

see what panes exist and which one is focused:

```bash
herdr pane list
```

the focused pane is yours. other panes are your neighbors.

list workspaces:

```bash
herdr workspace list
```

## core commands

| Action | Command |
|--------|---------|
| Read another pane's screen | `herdr pane read 1-1 --source recent --lines 50` |
| Split a pane, keep focus here | `herdr pane split 1-2 --direction right --no-focus` |
| Run a command in a pane | `herdr pane run 1-3 "npm run dev"` |
| Block until text appears | `herdr wait output 1-3 --match "ready" --timeout 30000` |
| Block until an agent finishes | `herdr wait agent-status 1-1 --status done --timeout 60000` |
| Send text without pressing Enter | `herdr pane send-text 1-1 "hello from claude"` |
| Send a keypress | `herdr pane send-keys 1-1 Enter` |

`pane read` sources: `--source visible` (current viewport), `--source recent` (rendered scrollback), `--source recent-unwrapped` (recent text with soft wraps joined — this is the transcript `wait output --source recent` actually matches against).

`pane split` prints json with the new pane id at `result.pane.pane_id`; parse it before running a command in that pane:

```bash
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW_PANE" "npm run dev"
```

`wait output` supports `--regex` for pattern matching; exit code is `1` on timeout.

tab management, workspace management, `pane close`, ready-made recipes (run a server and wait, run tests in a sibling pane, spawn and brief a new agent, coordinate with another agent), and the full notes on json output and id parsing are in [REFERENCE.md](REFERENCE.md).

if you need the raw protocol or full api reference, read the [socket api docs](https://herdr.dev/docs/socket-api/).
