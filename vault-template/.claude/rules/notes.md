---
paths:
  - "projects/**"
  - "knowledge/**"
  - "archive/**"
---
# Note Conventions (projects / knowledge / archive)

## Frontmatter

Every note should have:

```yaml
---
title: Document Title
created: YYYY-MM-DD
type: note|reference|meeting|idea|log|paper
tags: []
---
```

Optional fields: `related`, `source`, `summary`.

## Tags

| Prefix | Purpose | Example |
|--------|---------|---------|
| `#proj/<name>` | Project identifier | `#proj/workhub` |
| `#type/<type>` | Document type | `#type/reference`, `#type/meeting` |
| `#topic/<topic>` | Subject matter | `#topic/kubernetes`, `#topic/ml` |

Tags enable cross-folder collection — e.g. a note in `knowledge/infra/`
tagged `#proj/workhub` surfaces when querying that project.

## Wikilinks

- Use `[[wikilinks]]` for all internal vault references; `[text](url)` only
  for external URLs.
- Obsidian tracks renames automatically for wikilinks.
- When ingesting, auto-link the first occurrence of known document titles.
  Keep auto-links selective to avoid noisy notes.

## Indexes

- Zone indexes: `projects/_index.md`, `knowledge/_index.md`,
  `archive/_index.md` (~10-20 lines each). Update the relevant one when
  adding, moving, or archiving notes.
- Append to `_ai/logs/kb-log.md` for every ingest, lint, or index operation.
