---
argument-hint: What will the next session be used for?
description: Compact the current conversation into a handoff document for another agent to pick up.
disable-model-invocation: true
metadata:
    github-path: skills/productivity/handoff
    github-ref: refs/tags/v1.0.1
    github-repo: https://github.com/mattpocock/skills
    github-tree-sha: aa82ffd61d7a3bda110060b4e24ec782b983cb8d
name: handoff
---
Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
