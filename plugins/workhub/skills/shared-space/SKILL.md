---
name: shared-space
description: Record and use a team knowledge base that lives outside the vault - a network drive, Google Drive, OneDrive or SharePoint folder. Survey mode reads the place and writes down how it is organised into projects/<slug>/shared/; place mode says where a vault note belongs in it. Use when the user wants to register a team share for a project, refresh what is recorded about one, or work out where to file something.
argument-hint: "survey <project> <location> | place <note>"
---

# shared-space — the team knowledge bases outside the vault

A vault project's notes are for the owner and their agents. A team keeps its
own material somewhere else — a network drive, a Google Drive or SharePoint
folder — organised by conventions nobody wrote down anywhere the vault can see.

This skill records those places against a project, and uses what it recorded to
say where something belongs. It has two modes.

| Mode | What it does |
|---|---|
| `survey <project> <location>` | Read the place, work out how it is organised, and write `projects/<slug>/shared/<name>.md` |
| `place <note>` | Say where a vault note belongs in the project's shared spaces, and prepare the copy |

The app's **Projects** tab lists what `shared/` holds and offers a prompt that
launches survey mode; nothing about these notes is written by the app itself.

## What is worth recording

**The rules, not the folder tree.** Naming conventions, which kind of document
goes where, who owns what, what the review or approval step is. A listing of
every folder is stale within weeks and nobody reads it; keep the structure to
the parts that orient a reader.

A place with no rules to record is just a link, and belongs in the project's
`links.md` instead. Do not create a shared-space note for one.

## The note

`projects/<slug>/shared/<name>.md`. One file is one place; the folder is the
registry, so nothing lists these notes in `_index.md`. `<name>` is English
kebab-case, like every other folder name in the vault.

```markdown
---
type: shared-space
title: Design team share
kind: network-drive     # network-drive | google-drive | onedrive | sharepoint | other
location: //fileserver/design/projectX
access: mapped to Z:, needs VPN
direction: read-only    # read-only | export-ok
surveyed: 2026-09-05
---

## Structure

- `01_仕様/` — specifications, one folder per release
- `02_議事録/` — meeting minutes, `YYYY-MM-DD_<topic>.md`
- `99_archive/` — anything superseded

## Rules

- A file name starts with the date in `YYYYMMDD` (stated: `運用ルール.md`)
- Specifications are Word, minutes are Markdown (inferred)
- The release folder is created by the PM, not by contributors (stated)

## Placement

- Task deliverables about the UI → `01_仕様/<release>/`
- Meeting notes → `02_議事録/`

## Memo

The owner's own notes. Neither the app nor this skill rewrites this section.
```

`direction` is the safety valve, and it is the field to get right:

- `read-only` — never write anything into the place. This is the default, and
  what a missing or unrecognised value means.
- `export-ok` — the owner has said material may be filed into it.

## Survey mode

1. **Resolve the project.** The first argument is a project slug
   (`projects/<slug>/`) or part of a project's title. Vault resolution follows
   `task-start`: `WORKHUB_VAULT` → the current directory when it is a vault
   (it has `tasks/` and `_ai/`) → `vault_path` in
   `%APPDATA%\workhub\config.json`. Ask when nothing matches or several do.

2. **Check you can actually read the location.** This is the step that decides
   whether the rest is worth anything.

   - A UNC path, a mapped drive, or a local sync folder (Google Drive for
     desktop, OneDrive, Dropbox) can be listed and read directly.
   - A bare `https://drive.google.com/...` or SharePoint URL **cannot**. Ask
     for the local sync path instead, or for an export of the folder listing.
   - If neither is available, stop and say so. Do not write a note. A file of
     plausible invented conventions is worse than no file: the next reader
     cannot tell it apart from one that was checked.

3. **Read the place.** Bound the walk — a few levels, enough to see the shape.
   What to look for, in order:

   - A document that states the rules: `README`, `運用ルール`, `命名規則`,
     `フォルダ構成`, a wiki page, an onboarding deck. This is the jackpot; when
     it exists, most of `## Rules` comes from it.
   - The existing file and folder names. Conventions are visible in them —
     date prefixes, numbered folders, a per-release or per-customer split.
   - Which folders are alive and which are dead. A folder last touched three
     years ago is history, not structure.

4. **Write the note.** Mark every rule `(stated)` when a document in the place
   says so, and `(inferred)` when you read it off the file names. Never present
   a guess as a rule — the distinction is what makes the note trustworthy later.

   Set `surveyed:` to today. Ask the owner for `direction:` rather than
   deciding it; when they have not answered, write `read-only`.

5. **Link it.** Add a line to the project's `README.md` where it lists what the
   project holds, and run `/kb-index` so `_index.md` matches the folder.

6. **Report** what you recorded, and — separately — what you could not see and
   what you inferred rather than read. The gaps are the part the owner has to
   judge.

### Re-surveying

Surveying a place that already has a note is an **update**, not a new file.
Read the existing note first, change what has actually changed, and set
`surveyed:` to today. Leave `## Memo` exactly as it is. When a rule you had
recorded no longer holds, say so in the report rather than deleting it
silently — a convention that changed is news.

## Place mode

Given a vault note, say where it belongs in the project's shared spaces.

1. Read every note in the project's `shared/`.
2. Match the note against each place's `## Placement` and `## Rules`, and name
   the destination folder plus the file name the conventions imply.
3. **Check `direction` before offering to copy anything.** A `read-only` place
   is not a destination: say where the material *would* go and stop there.
4. For an `export-ok` place, show the source, the destination path and the file
   name, and ask the owner to confirm before copying. Copying a file into a
   team's shared drive is outward-facing — it is seen by other people and is
   awkward to take back.
5. After a copy, note it in the deliverable's own note (what was filed, where,
   when). That record is what makes it possible to tell later whether the two
   copies have diverged.

## What this skill does not do

- **It does not sync.** Filing something into a shared space is one-way,
  explicit and per-occasion. Two-way mirroring of a folder a team also edits
  produces conflicts and stale duplicates, and neither is worth the
  convenience.
- **It does not write into a place while surveying it**, whatever the
  `direction` says. A survey reads.
- **It does not delete or reorganise anything** in a shared space. The team
  owns it.
