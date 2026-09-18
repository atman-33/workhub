---
name: vault-upgrade
description: Bring a workhub vault's layout up to what the current app and plugins expect, after a structural change. Use when hooks stop injecting owner context, when the app reports a breaking change, or when a vault has not been opened in a long time.
disable-model-invocation: true
argument-hint: "[migration-id]"
---

# Vault Upgrade — carry a vault forward through a structural change

When the vault's shape changes — a folder moves, a note splits — existing
vaults do not move with it. They break **silently**: a hook gates on a path
that no longer exists, exits 0, and nothing tells anyone. The symptom is an
agent that asks things it should already know, which looks like the model
having a bad day rather than a layout problem.

This skill is the one place those changes are carried forward.

It is **not** the same as `vault-migrate`, which copies a *different* Obsidian
vault into this one. This one restructures the vault you are already in.

## Steps

### 1. See what applies

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/vault-upgrade/scripts/vault-upgrade.mjs" status
```

Each migration reports `NEEDED` or `done`, with the reason. Nothing needed
means the vault is current — say so and stop; do not go looking for work.

### 2. Show the owner exactly what would move

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/vault-upgrade/scripts/vault-upgrade.mjs" plan <id>
```

This is a dry run and touches nothing. Put its output in front of the owner
together with the migration's `why`, and **wait for their approval**. Three
things are worth saying in your own words, because they are what the owner is
actually deciding about:

- what moves, and where it lands;
- what is **left alone** — the runner never deletes, so the old files are still
  there afterwards and removing them is a later, separate decision;
- that a collision diverts the file already in place to `<name>.template.<ext>`
  rather than overwriting it, so nothing is lost either way.

### 3. Apply

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/vault-upgrade/scripts/vault-upgrade.mjs" apply <id>
```

It refuses to run when the vault has uncommitted changes — that refusal is what
keeps the whole run one `git checkout -- .` away from undone. Commit or discard
first; do not work around it.

Afterwards it re-runs the detection and fails loudly if the migration still
reports itself as needed, then prints the migration's own verification.

### 4. Report and hand back

Report in three parts: what moved, what was left alone, and **what was not
deleted**. Then:

- Have the owner review the diff and commit it. The vault is the record; an
  uncommitted migration is one crash away from being lost.
- Carry out the migration's follow-ups only after that commit — removing a
  source file is the owner's call, and only once its replacement is safely in.
- If anything was diverted to `*.template.*`, say so explicitly. That file is a
  decision waiting to be made, not litter.

## Rules

- **Never delete anything.** Not the source of a move, not an emptied folder,
  not a file the owner might have written. Everything here is recoverable by
  design, and one deletion ends that.
- **Never edit the contents of a note being moved.** A migration relocates and
  derives; rewriting the owner's prose is not in scope.
- **One migration at a time**, in id order, with the owner's approval each time.
- If the runner refuses, read the refusal. Every one of them names the
  condition it is protecting.

## Adding a migration

One migration is one module in `scripts/migrations/`, named `NNN-<slug>.mjs`
and registered in `MIGRATIONS` in `scripts/vault-upgrade.mjs`. It exports a
default object:

| Key | What |
|---|---|
| `id` / `title` / `since` | Identity, and the release the change landed in |
| `why` | The prose the owner is shown before approving |
| `detect(vault)` | `{ needed, reason, steps, left }` |
| `verify(vault)` | Optional. Lines a reader can check the result against |

**A migration only describes; the runner executes.** That is what keeps the
invariants true for every migration ever written rather than for the ones whose
author remembered them. `steps` are `mkdir`, `move` and `write`, and there is
deliberately no `delete`.

Two things follow from this and are easy to get wrong:

- **`detect` must answer `false` once the work is done**, because that is the
  whole of the idempotency guarantee — the runner checks it after applying and
  fails when it does not. If the migration leaves its source in place (and it
  should), the source's existence cannot be the signal. Use a marker in what was
  produced, the way `lib/decision-log.mjs` does.
- **`left` is not a to-do list for the agent.** It is what the owner is being
  told was deliberately not touched.
- **Expect the old path to come back.** An app from before your change still
  carries the old template, and starting it once after the migration seeds the
  old placeholders straight back — it happened to the first vault migration 001
  ran against. Give every `move` step the fingerprints of every version the
  template ever shipped at both ends (`seeds`, see `lib/seeds.mjs`), and have
  `detect` ignore a source that is only a placeholder. Without them a collision
  has no answer, and the runner stops rather than guess.
