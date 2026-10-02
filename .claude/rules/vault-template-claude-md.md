---
description: What may go into vault-template/CLAUDE.md, which every vault loads in every session
paths:
  - "vault-template/CLAUDE.md"
---

# Keeping `vault-template/CLAUDE.md` short

That file is loaded into every session of every vault, so a line there costs
every turn. It grew to 859 lines by accretion and was cut back in T-0542;
`scripts/check-claude-md-budget.mjs` fails CI above 250 lines.

- **Admit a line only if it applies to every session.** If one kind of work
  needs it, put it in `vault-template/.claude/rules/<name>.md` with `paths:`
  for the files that work touches, so it loads on demand; leave one pointer
  line here.
- **A format spec belongs in a path-scoped rule.** Schedule, mindmap,
  shared-space, backlog and task notes each have one. A new note type gets its
  own rule, not a new section here.
- **One source of truth.** If a skill already carries the procedure, point to
  the skill. If a rule carries the format, a skill points to the rule.
- **Keep the why short.** Rationale and history go in the rule or the
  backlog item; here, state the rule and one reason at most.
- **State the wanted behaviour.** Reserve "never" for hard guardrails (the
  `<important>` block); the rest says what to do.
- **A new rule file is delivered automatically.** The manifest is built from
  `vault-template/` at compile time, so the file only needs to exist there.
