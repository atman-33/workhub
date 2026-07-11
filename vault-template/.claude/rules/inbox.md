---
paths:
  - "inbox/**"
  - "journal/**"
---
# Inbox & Journal Rules

- `inbox/` is the raw-input landing zone. Notes there are unclassified by
  design — file them via `/kb-ingest`, not ad hoc.
- `inbox/**/README.md` files are structural notes that explain the intended
  use of local folders. Keep them in place; exclude them from ingest, rename,
  move, summary generation, backlink updates, and routine search results,
  unless the task is specifically about folder structure.
- `journal/` holds daily/weekly notes. Never ingest, move, rename, or index
  them; read them only for temporal queries ("what happened last week").
