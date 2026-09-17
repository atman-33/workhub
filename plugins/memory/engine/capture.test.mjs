/**
 * Regression tests for T-0366 — the capture path that silently lost 180 of 193
 * sessions to `database is locked`.
 *
 * The root cause was not contention itself but a read lock nobody knew they
 * held: node-sqlite3-wasm stops a single-row `get()` on the first row and
 * leaves the statement un-reset, so the connection keeps a SHARED lock until
 * the statement is finalized. `buildInjection` reads stats that way and then
 * awaits the embedding model for seconds, so parallel sessions starved the
 * Stop hook's writer past the busy timeout. "the read lock is released" below
 * pins that fix; the rest pin the retry and queue behaviour that keeps a busy
 * database from costing a session.
 *
 * The SQLite check runs in a spawned process rather than in-process: the WASM
 * driver does not initialize under Vite's module runner, and the check needs
 * two connections anyway.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureHealthLine,
  captureTranscript,
  drainQueue,
  isBusyError,
  queuedCount,
  withRetry,
} from "./lib/capture.mjs";
import { ENGINE_HOME } from "./lib/paths.mjs";

const engineDir = dirname(fileURLToPath(import.meta.url));
// The driver is installed into ENGINE_HOME by `memory-setup`, not into the
// repository. Where setup has not run (CI), the SQLite check is skipped and
// the logic tests still cover the retry and queue behaviour.
const engineInstalled = existsSync(join(ENGINE_HOME, "node_modules", "node-sqlite3-wasm"));

let dir;
let previousHome;

beforeEach(() => {
  dir = mkdtempSync(join(os.tmpdir(), "workhub-capture-"));
  // Point capture state and the retry queue at the temp directory so a test
  // run never touches the real install's queue.
  previousHome = process.env.WORKHUB_ENGINE_HOME;
  process.env.WORKHUB_ENGINE_HOME = dir;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.WORKHUB_ENGINE_HOME;
  else process.env.WORKHUB_ENGINE_HOME = previousHome;
  rmSync(dir, { recursive: true, force: true });
});

/** In-memory stand-in for the database: records what was written. */
function fakeDeps({ busy = 0, chunks = 1 } = {}) {
  const state = { opens: 0, closes: 0, written: 0, remainingBusy: busy };
  return {
    state,
    openDb: () => {
      state.opens += 1;
      if (state.remainingBusy > 0) {
        state.remainingBusy -= 1;
        throw new Error("database is locked");
      }
      return {
        close() {
          state.closes += 1;
        },
      };
    },
    loadChunks: () => Array.from({ length: chunks }, (_, i) => ({ user: `u${i}` })),
    saveChunks: (_db, parsed) => {
      state.written += parsed.length;
      return parsed.length;
    },
  };
}

describe("isBusyError", () => {
  it("matches a busy database and nothing else", () => {
    expect(isBusyError(new Error("database is locked"))).toBe(true);
    expect(isBusyError(new Error("SQLITE_BUSY: database is busy"))).toBe(true);
    expect(isBusyError(new Error("no such table: memories"))).toBe(false);
    expect(isBusyError(undefined)).toBe(false);
  });
});

describe("withRetry", () => {
  const noopHandle = () => ({ close() {} });

  it("retries a busy write until it succeeds", () => {
    let attempts = 0;
    const result = withRetry(noopHandle, () => {
      attempts += 1;
      if (attempts < 3) throw new Error("database is locked");
      return 7;
    });
    expect(result).toBe(7);
    expect(attempts).toBe(3);
  });

  it("does not retry an error that retrying cannot fix", () => {
    let attempts = 0;
    expect(() =>
      withRetry(noopHandle, () => {
        attempts += 1;
        throw new Error("no such table: memories");
      }),
    ).toThrow(/no such table/);
    expect(attempts).toBe(1);
  });

  it("closes the handle even when the write throws", () => {
    let closed = 0;
    expect(() =>
      withRetry(
        () => ({
          close() {
            closed += 1;
          },
        }),
        () => {
          throw new Error("no such table: memories");
        },
      ),
    ).toThrow();
    expect(closed).toBe(1);
  });
});

describe("captureTranscript", () => {
  function transcript(name = "session.jsonl") {
    const path = join(dir, name);
    writeFileSync(path, "{}\n");
    return path;
  }

  it("writes the session's chunks and reports capture as healthy", () => {
    const deps = fakeDeps();
    const result = captureTranscript(deps, transcript(), "T-0001");
    expect(result).toMatchObject({ inserted: 1, queued: false, drained: 0 });
    expect(captureHealthLine()).toBe("");
  });

  it("recovers from a busy database within the retry budget", () => {
    const deps = fakeDeps({ busy: 2 });
    const result = captureTranscript(deps, transcript(), "T-0001");
    expect(result).toMatchObject({ inserted: 1, queued: false });
    expect(queuedCount()).toBe(0);
    expect(captureHealthLine()).toBe("");
  });

  it("queues the session when the database stays busy, and says so", () => {
    const deps = fakeDeps({ busy: Number.MAX_SAFE_INTEGER });
    const path = transcript();
    const result = captureTranscript(deps, path, "T-0001");

    expect(result).toMatchObject({ inserted: 0, queued: true });
    expect(queuedCount()).toBe(1);
    // The loss has to be visible, not merely recorded — this is the part that
    // stayed silent for 46 days.
    expect(captureHealthLine()).toMatch(/未取り込み/);
  });

  it("drains a queued session as part of the next capture", () => {
    const path = transcript("queued.jsonl");
    captureTranscript(fakeDeps({ busy: Number.MAX_SAFE_INTEGER }), path, "T-0001");
    expect(queuedCount()).toBe(1);

    const healthy = fakeDeps();
    const later = captureTranscript(healthy, transcript("next.jsonl"), "T-0002");
    expect(later.drained).toBe(1);
    expect(later.inserted).toBe(1);
    expect(queuedCount()).toBe(0);
    expect(captureHealthLine()).toBe("");
  });

  it("keeps the queue when the drain itself hits a busy database", () => {
    const path = transcript("queued.jsonl");
    captureTranscript(fakeDeps({ busy: Number.MAX_SAFE_INTEGER }), path, "T-0001");

    const stillBusy = fakeDeps({ busy: Number.MAX_SAFE_INTEGER });
    expect(drainQueue(stillBusy)).toBe(0);
    expect(queuedCount()).toBe(1);
  });

  it("forgets a queued transcript whose file is gone", () => {
    const path = transcript("vanishing.jsonl");
    captureTranscript(fakeDeps({ busy: Number.MAX_SAFE_INTEGER }), path, "");
    expect(queuedCount()).toBe(1);

    rmSync(path);
    expect(queuedCount()).toBe(0);
    expect(drainQueue(fakeDeps())).toBe(0);
  });

  it("does not queue a failure that retrying cannot fix", () => {
    const broken = {
      ...fakeDeps(),
      openDb: () => {
        throw new Error("no such table: memories");
      },
    };
    expect(() => captureTranscript(broken, transcript(), "")).toThrow(/no such table/);
    expect(queuedCount()).toBe(0);
    expect(captureHealthLine()).toMatch(/連続失敗/);
  });
});

describe.runIf(engineInstalled)("Statement.get()", () => {
  it("releases the connection's read lock", () => {
    const dbPath = join(dir, "lock.db").replaceAll("\\", "/");
    const script = join(dir, "lock-check.mjs");
    // One process does the single-row read that getStats()/pendingCount() do,
    // then a second takes the write lock with a short busy timeout: before the
    // fix the reader held SHARED until close and the writer failed outright.
    writeFileSync(
      script,
      `import { createRequire } from "node:module";
       const require = createRequire(${JSON.stringify(join(ENGINE_HOME, "package.json"))});
       const { Database } = require("node-sqlite3-wasm");
       const { openDb, initDb } = await import(${JSON.stringify(
         pathToFileURL(join(engineDir, "lib", "db.mjs")).href,
       )});

       const reader = openDb(${JSON.stringify(dbPath)}, { Database });
       initDb(reader);
       reader.prepare("SELECT COUNT(*) AS n FROM memories").get();

       const writer = new Database(${JSON.stringify(dbPath)});
       writer.exec("PRAGMA busy_timeout = 250");
       try {
         writer.exec("BEGIN IMMEDIATE");
         writer.prepare("INSERT INTO memories (session_id, user_text, assistant_text, timestamp, created_at) VALUES (?,?,?,?,?)")
           .run(["w", "u", "a", "t", 1]);
         writer.exec("COMMIT");
         console.log("WRITE_OK");
       } catch (err) {
         console.log("WRITE_FAILED: " + err.message);
       }
       writer.close();
       reader.close();`,
    );

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("WRITE_OK");
  });
});
