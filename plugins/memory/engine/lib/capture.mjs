// Durable capture: retry a busy database, keep what could not be written, and
// record whether capture is actually working.
//
// Capture used to be a single best-effort attempt whose exception was swallowed
// by the Stop hook. When the database was busy the session's chunks were gone
// for good, and nothing said so — 180 of 193 sessions were lost that way before
// anyone noticed (T-0366). The read-lock leak that caused the contention is
// fixed in db.mjs; this module makes the remaining failure modes survivable:
//
//   - a busy database is retried with backoff instead of dropped;
//   - a transcript that still cannot be written is queued and re-tried by the
//     next capture, so the session is delayed rather than lost;
//   - every attempt updates a state file, so `status` and the session briefing
//     can say when capture last succeeded and how much is waiting.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { captureQueuePath, captureStatePath } from "./paths.mjs";

const RETRY_DELAYS_MS = [100, 400, 1200];
// A queued transcript is only worth retrying while the file still exists and
// the session is recent enough to be worth remembering.
const QUEUE_MAX_AGE_MS = 14 * 86400 * 1000;
const QUEUE_MAX_ENTRIES = 200;

/** Busy-database errors are worth retrying; a schema or disk error is not. */
export function isBusyError(err) {
  return /database is locked|database table is locked|SQLITE_BUSY/i.test(err?.message ?? "");
}

function sleepSync(ms) {
  // The Stop hook is synchronous and short-lived, and the whole point is to
  // hold still while another process finishes its write.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function readCaptureState() {
  try {
    return JSON.parse(readFileSync(captureStatePath(), "utf8"));
  } catch {
    return { lastSuccessAt: null, lastFailureAt: null, lastError: "", consecutiveFailures: 0 };
  }
}

function writeCaptureState(state) {
  try {
    writeFileSync(captureStatePath(), JSON.stringify(state, null, 2));
  } catch {
    // Health reporting must never be the reason a capture fails.
  }
}

function recordSuccess() {
  const state = readCaptureState();
  writeCaptureState({
    ...state,
    lastSuccessAt: Date.now() / 1000,
    lastError: "",
    consecutiveFailures: 0,
  });
}

function recordFailure(message) {
  const state = readCaptureState();
  writeCaptureState({
    ...state,
    lastFailureAt: Date.now() / 1000,
    lastError: message,
    consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
  });
}

export function readQueue() {
  if (!existsSync(captureQueuePath())) return [];
  const entries = [];
  for (const line of readFileSync(captureQueuePath(), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A torn line from a crashed append — drop just that line.
    }
  }
  return entries;
}

function writeQueue(entries) {
  try {
    if (!entries.length) {
      rmSync(captureQueuePath(), { force: true });
      return;
    }
    writeFileSync(captureQueuePath(), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch {
    // Same as the state file: never fail a capture over its own bookkeeping.
  }
}

/** Queue a transcript for a later attempt. Appends, so parallel hooks do not clobber each other. */
export function enqueue(transcriptPath, taskId) {
  const entry = { transcript: transcriptPath, task: taskId ?? "", queuedAt: Date.now() / 1000 };
  try {
    appendFileSync(captureQueuePath(), JSON.stringify(entry) + "\n");
  } catch {
    // Nothing else to fall back to; the failure is already in the state file.
  }
}

/** Entries still worth retrying, newest first, deduplicated by transcript path. */
function liveQueueEntries() {
  const cutoff = Date.now() / 1000 - QUEUE_MAX_AGE_MS / 1000;
  const seen = new Set();
  const live = [];
  for (const entry of readQueue().reverse()) {
    if (!entry.transcript || seen.has(entry.transcript)) continue;
    seen.add(entry.transcript);
    if ((entry.queuedAt ?? 0) < cutoff) continue;
    if (!existsSync(entry.transcript)) continue;
    live.push(entry);
    if (live.length >= QUEUE_MAX_ENTRIES) break;
  }
  return live;
}

export function queuedCount() {
  return liveQueueEntries().length;
}

/**
 * Run `fn` against a fresh database handle, retrying while the database is
 * busy. `openFn` must return an open, initialized database; it is re-opened on
 * every attempt so a handle is never reused after a failed write.
 */
export function withRetry(openFn, fn) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    let db;
    try {
      db = openFn();
      return fn(db);
    } catch (err) {
      lastError = err;
      if (!isBusyError(err) || attempt === RETRY_DELAYS_MS.length) throw err;
      sleepSync(RETRY_DELAYS_MS[attempt]);
    } finally {
      try {
        db?.close();
      } catch {
        // closing a handle that failed to open
      }
    }
  }
  throw lastError;
}

/**
 * Capture one transcript, retrying a busy database and queueing it when the
 * retries run out. Returns `{ inserted, queued, drained }`.
 *
 * `deps` carries the pieces the caller has already resolved, so this module
 * stays free of hook- and CLI-specific path resolution:
 *   openDb()      -> an open, initialized database
 *   loadChunks(p) -> chunks parsed from a transcript
 *   saveChunks(db, chunks, taskId) -> number of rows inserted
 */
export function captureTranscript({ openDb, loadChunks, saveChunks }, transcriptPath, taskId = "") {
  // Drain first: a transcript that was queued earlier is older than this one,
  // and draining before the new write keeps the queue from growing unbounded
  // while capture is healthy.
  const drained = drainQueue({ openDb, loadChunks, saveChunks });

  let chunks;
  try {
    chunks = loadChunks(transcriptPath);
  } catch (err) {
    recordFailure(`transcript unreadable: ${err.message}`);
    return { inserted: 0, queued: false, drained };
  }
  if (!chunks.length) return { inserted: 0, queued: false, drained };

  try {
    const inserted = withRetry(openDb, (db) => saveChunks(db, chunks, taskId));
    recordSuccess();
    return { inserted, queued: false, drained };
  } catch (err) {
    recordFailure(err.message);
    if (isBusyError(err)) {
      enqueue(transcriptPath, taskId);
      return { inserted: 0, queued: true, drained };
    }
    throw err;
  }
}

/**
 * Capture chunks that arrive without a transcript file — the OpenCode plugin
 * hands its messages over as JSON. Retries a busy database like
 * {@link captureTranscript} and records health the same way, but cannot queue:
 * there is no file to re-read later, so a write that runs out of retries
 * throws. Returns the number of rows inserted.
 */
export function captureChunks({ openDb, saveChunks }, chunks, taskId = "") {
  if (!chunks.length) return 0;
  try {
    const inserted = withRetry(openDb, (db) => saveChunks(db, chunks, taskId));
    recordSuccess();
    return inserted;
  } catch (err) {
    recordFailure(err.message);
    throw err;
  }
}

/**
 * Re-try every queued transcript. Entries that succeed — and entries whose
 * transcript is gone or too old to matter — leave the queue; the rest stay for
 * the next run. Returns the number of chunks written.
 */
export function drainQueue({ openDb, loadChunks, saveChunks }) {
  const entries = liveQueueEntries();
  if (!entries.length) {
    // Also clears entries that expired or whose transcript was deleted.
    if (readQueue().length) writeQueue([]);
    return 0;
  }

  const remaining = [];
  let written = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    try {
      const chunks = loadChunks(entry.transcript);
      if (chunks.length) {
        written += withRetry(openDb, (db) => saveChunks(db, chunks, entry.task ?? ""));
      }
    } catch (err) {
      // A transcript that cannot be parsed will never parse, so only a busy
      // database is worth keeping — and if the database is busy now it will be
      // busy for the rest of this drain, so stop instead of hammering it.
      if (isBusyError(err)) {
        remaining.push(...entries.slice(i));
        break;
      }
    }
  }
  writeQueue(remaining);
  if (written > 0) recordSuccess();
  return written;
}

/**
 * One line describing capture health, or "" when everything is fine.
 * Shown by `status` and prepended to a session's first injected block, because
 * a memory that has quietly stopped recording is worse than no memory at all.
 */
export function captureHealthLine() {
  const state = readCaptureState();
  const queued = queuedCount();
  const failures = state.consecutiveFailures ?? 0;
  if (!queued && failures === 0) return "";
  const parts = [];
  if (queued) parts.push(`未取り込みのセッション ${queued} 件`);
  if (failures) parts.push(`連続失敗 ${failures} 回`);
  if (state.lastError) parts.push(`直近のエラー: ${state.lastError}`);
  return `⚠️ メモリの記録が滞っています（${parts.join(" / ")}）。\`memory-recall\` の status で確認してください。`;
}
