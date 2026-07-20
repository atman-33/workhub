---
name: memory-setup
description: Set up the workhub long-term memory engine on this machine - install its dependencies, download the local embedding model, initialize the vault memory database, and verify the result. Use when the workhub app prompts for memory setup, when memory hooks report they are skipped, or when the user asks to enable/repair long-term memory.
---

# memory-setup — Enable long-term memory on this machine

The workhub plugin ships memory hooks that save each session's Q&A pairs
into a vault-local SQLite database and inject relevant past conversations
into new sessions (hybrid FTS5 + vector search, fully local, no LLM).
The hooks stay silently disabled until this one-time machine setup has run.

## Steps

1. **Run the idempotent setup script** (safe to re-run; fast no-op when
   already set up):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/memory-engine/cli.mjs" setup
   ```

   This installs npm dependencies (better-sqlite3, sqlite-vec,
   @huggingface/transformers) into `~/.workhub/memory-engine/`, downloads
   the embedding model (~320 MB, one time) into
   `~/.workhub/memory-engine/models/`, creates `<vault>/_ai/memory/memory.db`,
   makes sure the vault `.gitignore` excludes the database, and writes the
   `.setup-version` marker the hooks and the workhub app check.

   The first run takes several minutes (native module install + model
   download). Warn the user before starting if they seem to be in a hurry.

2. **Verify**:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/memory-engine/cli.mjs" status
   ```

   Report the summary (setup state, database path, memory counts) to the
   user. From the next session on, memory capture and injection are active.

## Troubleshooting

- **npm install fails building better-sqlite3**: a C/C++ toolchain may be
  missing; prebuilt binaries cover common Node versions, so first check
  `node --version` (needs Node 20+) and retry with
  `node cli.mjs setup --force`.
- **Model download fails**: network issue — rerun step 1; the download
  resumes from the HF cache.
- **Engine version changed after a plugin update**: hooks fall back to
  silent no-op; rerun step 1 (the marker version mismatch triggers a
  reinstall automatically).
- Setup never runs inside hooks; if the user does not want long-term memory
  on this machine, simply do not run this skill (everything stays disabled)
  and dismiss the app's setup notice via its settings.
