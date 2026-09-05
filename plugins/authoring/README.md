# authoring

Writing something in prose and handing it to someone. Text deliverables, and
the delivery of what comes out of them.

## Install

Install at user scope so it is available from any working directory:

```
claude plugin install authoring@workhub-marketplace
```

## Skills

| Skill | For |
|---|---|
| `create-readme` | a project's README |
| `create-claude-md` | a project's CLAUDE.md |
| `create-release-notes` | user-facing release notes from Conventional Commits |
| `create-work-log` | a daily/weekly work log from git activity across repos |
| `post-to-slack` | delivering the result to a Slack channel |

No vault or project-context dependency.

## Visual deliverables live elsewhere

Slide decks, self-contained HTML documents and PDF export are the
[`visuals`](../visuals/README.md) plugin's job. `draft-deck`,
`prepare-proposal-deck` and `generate-html-report` were removed from here in
favour of it: all three stopped at a prompt for an external design tool or
produced HTML without a design system behind it, and `visuals` renders the
deliverable in the session instead.
