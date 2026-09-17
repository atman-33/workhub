// SessionStart hook: tell the session where things stand, before its first
// prompt.
//
// The brief is deliberately structured — the open decisions and the live
// threads, asked for by type and status — rather than whatever came out
// nearest in a vector space. It also reports when capture has stopped
// recording, because a memory that has quietly stopped working looks exactly
// like a memory with nothing to say (T-0366).
//
// Silent no-op when the engine is not set up, when memory is switched off for
// Claude Code, or outside the vault.
import { readPayload } from "../lib/hook-input.mjs";

try {
  const paths = await import("../engine/lib/paths.mjs");
  if (!paths.readMarker() || !paths.memoryEnabled("claude_code")) process.exit(0);

  const vault = paths.resolveVaultForHook();
  if (!vault) process.exit(0);

  readPayload();

  const { loadSqlite } = await import("../engine/lib/deps.mjs");
  const sqlite = loadSqlite();
  const { buildBrief } = await import("../engine/lib/brief.mjs");

  // The database only supplies the time line. Everything else comes from the
  // Markdown, so a brief still works on a machine whose index is broken —
  // which is precisely when its health line matters most.
  let stats = null;
  if (sqlite) {
    const dbLib = await import("../engine/lib/db.mjs");
    const db = dbLib.openDb(paths.dbPathForVault(vault), sqlite);
    try {
      dbLib.initDb(db);
      stats = dbLib.getStats(db);
    } finally {
      db.close();
    }
  }

  const text = buildBrief(vault, stats);
  if (text) console.log(text);
} catch (err) {
  // Never fail a session over a memory problem.
  console.error(`[workhub-memory] brief skipped: ${err.message}`);
}
process.exit(0);
