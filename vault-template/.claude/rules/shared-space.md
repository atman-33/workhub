---
paths:
  - "projects/*/shared/**"
---

# Shared-space notes

Format of a project's `shared/` notes. The `shared-space` skill follows this file; the spec lives here, not in the skill.

`shared/` records the team knowledge bases that live **outside** the vault — a
network drive, a Google Drive or SharePoint folder, whatever the team actually
files things in. One file is one place. The folder is the registry: nothing
lists these notes in `_index.md`, the app and the `shared-space` skill read the
folder itself, the same way `schedules/` and `mindmaps/` do.

What is worth recording is the place's **rules** — naming conventions, which
kind of document goes where, who owns what. A snapshot of the folder tree goes
stale within weeks, so it is kept only as orientation. A place with no rules to
record is just a link, and belongs in `links.md` instead.

Frontmatter is flat:

```yaml
---
type: shared-space
title: Design team share
kind: network-drive    # network-drive | google-drive | onedrive | sharepoint | other
location: //fileserver/design/projectX
access: mapped to Z:, needs VPN
direction: read-only   # read-only | export-ok
surveyed: 2026-09-05
---
```

- `location` is the place's canonical address — a UNC path, a local sync path,
  or a URL. `access` is the human note on how to reach it from this machine.
- **`direction` is the safety valve.** `read-only` means never write anything
  there; `export-ok` means the owner has said material may be filed into it. A
  note whose `direction` is missing or unreadable is treated as `read-only`.
- `surveyed` is when the rules below were last checked against reality.

The body has four sections, in document order:

| Section | Contents |
|---|---|
| `## Structure` | The parts of the folder tree that matter, as orientation — not an exhaustive listing |
| `## Rules` | How the place is organised. Mark each rule `(stated)` when a document in the place says so, `(inferred)` when it was read off the existing files |
| `## Placement` | Which vault notes belong where in that place. Only meaningful for `export-ok` places |
| `## Memo` | The owner's own notes; neither the app nor an agent rewrites this section |

The `shared-space` skill surveys a place and writes the note; the app's
**Projects** tab lists what `shared/` holds, and offers a prompt to paste into
an agent when a project has no shared space registered yet.

Filing vault material into a shared space is always one-way, explicit, and
per-occasion. There is no sync: mirroring a place the team also edits produces
conflicts and stale duplicates, and neither is worth the convenience.
