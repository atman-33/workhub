---
type: shared-space
title: Team share (example)
kind: network-drive
location: //fileserver/team/project
access: mapped to Z:, needs VPN
direction: read-only
surveyed: 1970-01-01
---

Delete this file once the project has a real shared-space note. The
`shared-space` skill writes them; see "Shared-space notes" in the vault's
CLAUDE.md for what each field means.

`direction: read-only` means never write anything into the place. Only the
owner promotes a place to `export-ok`.

## Structure

- `01_specs/` — one folder per release
- `02_minutes/` — meeting minutes

## Rules

- File names start with `YYYYMMDD` (stated: the place's own rules document)
- Minutes are Markdown, specifications are Word (inferred from what is there)

## Placement

- UI task deliverables → `01_specs/<release>/`

## Memo

Yours. Neither the app nor an agent rewrites this section.
