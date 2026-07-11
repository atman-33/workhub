---
description: Use when building or improving a Claude Code slash command in a project's own `.claude/commands/`: $ARGUMENTS handling, file/bash injection, agent invocation, multi-agent orchestration, or command naming.
name: create-claude-command
---
# Claude Code Commands

> Within workhub itself, author a skill with `disable-model-invocation:
> true` instead of a new plugin command — see `.claude/rules/skill-authoring.md`.
> This skill is for authoring `.claude/commands/` in any other project.

## Quick Reference

| Component | Purpose | Example |
|-----------|---------|---------|
| Filename | Command name | `review.md` → `/review` |
| `$ARGUMENTS` | Full user input | `/review auth.js` → `$ARGUMENTS = "auth.js"` |
| `$1`, `$2` | Positional args | `/compare a.js b.js` → `$1 = "a.js"`, `$2 = "b.js"` |
| `@file` | Include file contents | `@CLAUDE.md` |
| `!command` | Include bash output | `!git status` |

## Command Locations

| Location | Scope |
|----------|-------|
| `.claude/commands/` | Project (version-controlled, team-shared) |
| `~/.claude/commands/` | Personal (cross-project, not shared) |

## The Scaffold

Every command is a scaffold — a markdown prompt template the user fills at invocation time:

```markdown
---
description: Brief description for SlashCommand tool integration
---

# Command Title

[Instructions for what this command does]

User request: $ARGUMENTS

## Steps

1. [First action]
2. [Second action]

## Output Format

[Expected output structure]
```

The `description:` frontmatter is required for the SlashCommand tool to reference the command. Always include `## Output Format` — without it the agent decides its own output shape, which varies run to run.

## Naming Conventions

| Pattern | Example | Use For |
|---------|---------|---------|
| `{action}` | `/review` | Simple actions |
| `{action}-{target}` | `/security-scan` | Specific targets |
| `{domain}-{action}` | `/pm-strategy` | Domain-prefixed |
| `{tool}-{action}` | `/git-commit` | Tool-specific |

## Command vs Agent vs Skill

| | Command | Agent | Skill |
|--|---------|-------|-------|
| **Trigger** | User types `/command` | Claude decides | Claude loads |
| **Purpose** | Quick shortcuts | Complex work | Knowledge |
| **Statefulness** | Stateless | Maintains context | Reference only |

**Flow**: User → Command → Agent → Skill

---

For full $ARGUMENTS examples, command patterns (agent invocation, multi-agent orchestration, validation checklist), and advanced patterns (conditional logic, flag parsing), see [REFERENCE.md](REFERENCE.md).
