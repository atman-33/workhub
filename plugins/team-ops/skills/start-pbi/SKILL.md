---
name: start-pbi
description: Start work on a PBI - set it to doing and issue the convention-compliant work branch name (pbi/<id>-<slug>). Use when a developer picks up a backlog item, or asks which branch name to use for a PBI.
---

# Start a PBI

The branch-naming convention is enforced here, at the moment work begins —
it is what later links merged code back to the PBI
(`sync-project-repos.mjs` extracts ids from merge subjects).

## Steps

1. Resolve the project and PBI (by id like `P-0012`, or by title search in
   `backlog/items/`).
2. **Update the PBI file**: `status: doing`, `assignee: <me>` (from
   `<team-context>`), `updated: <date>`; mirror the status in
   `product-backlog.md`.
3. **Issue the branch name**: `pbi/<id-lowercase>-<slug>` (e.g.
   `pbi/p-0012-user-login`), slug from the item filename. State it clearly
   and remind: merge/PR titles into the project's dev-main branch must carry
   the id (branch name or a `[P-0012]` tag).
4. If asked, create the branch in the user's own checkout of the relevant
   repo (`repos` frontmatter / project.json), cut from the project's
   **devMainBranch** — never in the script-owned mirror under
   `repoWorkspacesRoot`.
5. Append an activity-log line
   (`- <date> [<agent>/<me>] start-pbi: P-0012 → doing, branch pbi/p-0012-...`).
