// Stop hook: save the session's Q&A chunks into the vault memory database
// (text only — embedding happens in a detached background process).
// Silent no-op when the memory engine is not set up on this machine; a hook
// must never break a session.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readPayload } from "./lib.mjs";

try {
  const { readMarker, resolveVault, dbPathForVault } = await import(
    "../memory-engine/lib/paths.mjs"
  );
  if (!readMarker()) process.exit(0);

  const payload = readPayload();
  const transcriptPath = payload.transcript_path ?? "";
  if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0);

  const vault = resolveVault();
  if (!vault) process.exit(0);

  const { loadSqlite } = await import("../memory-engine/lib/deps.mjs");
  const sqlite = loadSqlite();
  if (!sqlite) process.exit(0);

  const { loadChunks } = await import("../memory-engine/lib/chunker.mjs");
  const chunks = loadChunks(transcriptPath);
  if (!chunks.length) process.exit(0);

  // Tag the session's chunks with the active workhub task, when one is set.
  let taskId = "";
  try {
    taskId = JSON.parse(
      readFileSync(join(vault, "_ai", "memory", "active-task.json"), "utf8"),
    ).id ?? "";
  } catch {
    // no active task — chunks are stored untagged
  }

  const { openDb, initDb, saveChunksTextOnly } = await import("../memory-engine/lib/db.mjs");
  const db = openDb(dbPathForVault(vault), sqlite);
  try {
    initDb(db);
    const inserted = saveChunksTextOnly(db, chunks, taskId);
    if (inserted > 0) {
      console.error(`[workhub-memory] saved ${inserted} chunk(s)`);
    }
    const { maybeTriggerEmbed } = await import("../memory-engine/lib/background.mjs");
    const pending = maybeTriggerEmbed(db);
    if (pending > 0) {
      console.error(`[workhub-memory] ${pending} pending — background embedding started`);
    }
  } finally {
    db.close();
  }
} catch (err) {
  // Never fail the Stop hook over a memory problem.
  console.error(`[workhub-memory] capture skipped: ${err.message}`);
}
process.exit(0);
