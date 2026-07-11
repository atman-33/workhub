# Role-based delegation & model selection

This project uses role-based sub-agents (shipped by the `engineering` plugin) so
that each kind of work runs in its own context on a model matched to its cost and
difficulty. Use these criteria from the main session when deciding whether — and
to whom — to delegate.

## When to delegate (and when not to)

- **Delegate** tasks that need reading several files or trial-and-error: broad
  investigation, multi-file implementation, debugging loops, running test suites.
- **Do not delegate** a one- or two-file edit you can do directly — the round-trip
  costs more than it saves.
- **Batch** several small, related tasks into a single delegation rather than
  spawning one agent per task.

Keep planning and design judgment in the main session. Delegate execution.

## Which agent

| Task | Agent | Model |
|------|-------|-------|
| Broad code investigation / reference tracing (read-only) | `code-explore` | sonnet |
| Implementing a settled, mostly-mechanical change | `implementer` | sonnet |
| Large / multi-file implementation or debugging | `heavy-implementer` | sonnet |
| Running tests/build/lint and summarizing the result | `test-runner` | haiku |

## What to pass to an agent

When delegating, hand over **file paths and a step/spec reference** — not large
pasted context. The agent reads what it needs in its own context. If you wrote a
Plan file, annotate each implementation step with its owner
(`main` / `implementer` / `heavy-implementer`) and pass the step references.

If the task matches an existing skill's process (e.g. `tdd`, `verify`,
`simplify`), which agent drives it follows the same size criteria above —
`implementer` has no `Skill`/`Bash` tools, so it cannot run a skill's process
loop itself:

- **Settled/small work:** invoke the skill yourself from the main session and
  delegate only the concrete edits to `implementer` in small, focused
  batches; the main session runs tests/checks between rounds.
- **Large/uncertain work:** hand `heavy-implementer` the spec and name the
  skill — it has `Skill`/`Bash`/`Agent` and will invoke and drive the process
  directly end to end. It may also nest-delegate verbose sub-tasks (test
  runs, sub-investigations) to `test-runner`/`code-explore` on its own; you
  don't need to chain those separately.

## Report contract (expected back from agents)

Agents return **only**: the list of changed files, the key decisions/trade-offs,
and verification results. They do not paste file contents, the code they wrote,
or verbose logs. Findings come back as `file_path:line_number` references. Hold
delegated agents to this so results stay cheap to fold back in.
