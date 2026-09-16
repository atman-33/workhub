// Stop hook: save the session's Q&A chunks into the vault memory database
// (text only — embedding happens in a detached background process).
// Silent no-op when the memory engine is not set up on this machine; a hook
// must never break a session.
//
// A busy database is retried and, failing that, queued for the next capture —
// see memory-engine/lib/capture.mjs. Dropping the session outright is what
// silently lost 180 of 193 sessions before T-0366.
import { existsSync } from "node:fs";
import { readPayload } from "./lib.mjs";
import {
  readMarker as readSessionMarker,
  sessionKey,
} from "../lib/session-marker.mjs";

try {
  const { readMarker, memoryEnabled, resolveVaultForHook, dbPathForVault } = await import(
    "../memory-engine/lib/paths.mjs"
  );
  if (!readMarker() || !memoryEnabled("claude_code")) process.exit(0);

  const payload = readPayload();
  const transcriptPath = payload.transcript_path ?? "";
  if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0);

  const vault = resolveVaultForHook();
  if (!vault) process.exit(0);

  const { loadSqlite } = await import("../memory-engine/lib/deps.mjs");
  const sqlite = loadSqlite();
  if (!sqlite) process.exit(0);

  // Tag the session's chunks with the task THIS session is working, when one
  // is set. Reading a shared marker used to file a transcript under whichever
  // task happened to be started last, which under two parallel sessions was
  // routinely the other one's (T-0243).
  const taskId = readSessionMarker(vault, sessionKey(payload.session_id))?.id ?? "";

  const { loadChunks } = await import("../memory-engine/lib/chunker.mjs");
  const { openDb, initDb, saveChunksTextOnly } = await import("../memory-engine/lib/db.mjs");
  const { captureTranscript } = await import("../memory-engine/lib/capture.mjs");

  // A fresh handle per attempt: capture retries a busy database, and a handle
  // that failed a write is not reused.
  const deps = {
    openDb: () => {
      const db = openDb(dbPathForVault(vault), sqlite);
      initDb(db);
      return db;
    },
    loadChunks,
    saveChunks: saveChunksTextOnly,
  };

  const { inserted, queued, drained } = captureTranscript(deps, transcriptPath, taskId);
  if (drained > 0) {
    console.error(`[workhub-memory] recovered ${drained} chunk(s) from the retry queue`);
  }
  if (inserted > 0) {
    console.error(`[workhub-memory] saved ${inserted} chunk(s)`);
  }
  if (queued) {
    console.error("[workhub-memory] database busy — session queued for the next capture");
  }

  // Embedding is triggered on its own short-lived handle: the capture above
  // has already closed its connection, and a trigger failure must not be
  // reported as a capture failure.
  try {
    const { maybeTriggerEmbed } = await import("../memory-engine/lib/background.mjs");
    const db = deps.openDb();
    try {
      const pending = maybeTriggerEmbed(db);
      if (pending > 0) {
        console.error(`[workhub-memory] ${pending} pending — background embedding started`);
      }
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[workhub-memory] embed trigger skipped: ${err.message}`);
  }
} catch (err) {
  // Never fail the Stop hook over a memory problem.
  console.error(`[workhub-memory] capture skipped: ${err.message}`);
}
process.exit(0);
