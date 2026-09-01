# agent-ops

Running agents in a terminal multiplexer, and the machine setup that makes that
work. These skills belong together because they share one prerequisite: a
multiplexer (herdr, or Zellij) that can split panes and spawn agents into them.

## Install

Install at user scope so it is available from any working directory:

```
claude plugin install agent-ops@workhub-marketplace
```

## Skills

| Skill | For |
|---|---|
| `setup-herdr` | installing herdr and wiring its Claude Code / OpenCode integrations |
| `setup-zellij` | installing Zellij and its shell autostart |
| `herdr` | driving a running herdr instance from inside it |
| `handoff` | compacting a conversation into a handoff document |
| `handoff-go` | writing the handoff and launching the next agent in a split pane |
| `launch-team` | a role-based team of agents in separate panes, messaging each other |
| `sidekick-go` | a persistent helper agent in its own pane, iterated with over rounds |
| `wsl-vscode-doctor` | `code .` misbehaving in a herdr-spawned WSL shell |

The workhub app launches each AI task in a fresh herdr workspace when herdr is
installed, which is why `setup-herdr` is the one most vaults reach for first.

No vault or project-context dependency.
