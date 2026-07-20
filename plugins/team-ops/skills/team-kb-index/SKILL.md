---
name: team-kb-index
description: Rebuild or repair the team knowledge base indexes (_index.md files) in the team-shared folder. Use after several notes were added or moved, when indexes look stale, or when team-kb-save reports a larger reshuffle is needed.
---

# Maintain the team KB indexes

Keep every `_index.md` under `<teamRoot>/ai/knowledge/` an accurate,
one-line-per-note catalog — the KB's search surface for humans and agents.

## Steps

1. Resolve the KB root from `<team-context>`.
2. **Inventory**: Glob `knowledge/**/*.md`, excluding `_index.md` files.
3. **Per topic folder**: regenerate its `_index.md` — a heading, one table
   or list line per note (`[title](file.md) — one-line hook`), in the team
   content language. Preserve any hand-written prose above the listing.
4. **Root index**: regenerate the topic table in `knowledge/_index.md`
   (topic → what lives there). List topics that gained a folder but have no
   `_index.md` yet, and create those.
5. **Report drift**: notes not reachable from any index, empty topic
   folders, or names violating kebab-case — fix mechanically where obvious,
   otherwise list for the user.
6. Append one line to `_meta/activity-log.md`
   (`- <date> [<agent>/<me>] team-kb-index: rebuilt N indexes`).
