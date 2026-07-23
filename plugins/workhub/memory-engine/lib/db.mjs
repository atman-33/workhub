// SQLite storage for memory chunks: node-sqlite3-wasm + an FTS5 trigram index,
// with cosine distance computed in JavaScript over the embedding BLOBs. Port of
// sui-memory's storage.py, extended with a task_id column for workhub task
// context.
import { closeSync, existsSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname } from "node:path";

const BUSY_TIMEOUT_MS = 5000;

// Offsets 18/19 of the SQLite header are the write/read format versions: 2
// means the file is in WAL mode, 1 a rollback journal.
const HEADER_JOURNAL_OFFSET = 18;
const WAL_FORMAT = 2;
const ROLLBACK_FORMAT = 1;

function readJournalFormat(dbPath) {
  const fd = openSync(dbPath, "r");
  try {
    const header = Buffer.alloc(20);
    if (readSync(fd, header, 0, 20, 0) < 20) return null;
    return header[HEADER_JOURNAL_OFFSET];
  } finally {
    closeSync(fd);
  }
}

/**
 * Take a database out of WAL mode.
 *
 * Engine versions up to 1 used better-sqlite3 and set `journal_mode = WAL`,
 * which is recorded in the file header. The WASM build has no WAL support and
 * refuses to open such a file at all ("unable to open database file"), so an
 * existing database has to be converted once before it can be used again.
 * Node's built-in `node:sqlite` does the conversion properly (checkpoint +
 * header rewrite); where it is unavailable (Node < 22.5) the header can be
 * flipped directly, but only when no `-wal` file is left holding committed
 * pages.
 */
export function migrateOutOfWal(dbPath) {
  if (!existsSync(dbPath) || readJournalFormat(dbPath) !== WAL_FORMAT) return false;

  try {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("PRAGMA journal_mode = DELETE").get();
    } finally {
      db.close();
    }
    return true;
  } catch {
    // fall through to the header rewrite
  }

  if (existsSync(`${dbPath}-wal`)) {
    throw new Error(
      `${dbPath} is in WAL mode and cannot be converted on this Node version ` +
        `(needs Node 22.5+ for node:sqlite). Upgrade Node and re-run memory setup.`,
    );
  }
  const fd = openSync(dbPath, "r+");
  try {
    writeSync(fd, Buffer.from([ROLLBACK_FORMAT, ROLLBACK_FORMAT]), 0, 2, HEADER_JOURNAL_OFFSET);
  } finally {
    closeSync(fd);
  }
  return true;
}

// node-sqlite3-wasm exposes `db.all/get/run(sql, params)` and statements that
// must be finalized explicitly. The rest of this module — and its port history
// — is written against the better-sqlite3 surface, so wrap the raw handle in a
// thin adapter instead of rewriting every call site.
class Statement {
  constructor(raw, sql) {
    this.stmt = raw.prepare(sql);
  }
  get(...params) {
    return this.stmt.get(params);
  }
  all(...params) {
    return this.stmt.all(params);
  }
  run(...params) {
    return this.stmt.run(params);
  }
  finalize() {
    this.stmt.finalize();
  }
}

class Db {
  constructor(raw) {
    this.raw = raw;
    this.statements = [];
  }
  prepare(sql) {
    const stmt = new Statement(this.raw, sql);
    this.statements.push(stmt);
    return stmt;
  }
  exec(sql) {
    this.raw.exec(sql);
  }
  /** better-sqlite3-style transaction wrapper: returns a callable. */
  transaction(fn) {
    return (...args) => {
      this.raw.exec("BEGIN");
      try {
        const result = fn(...args);
        this.raw.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          this.raw.exec("ROLLBACK");
        } catch {
          // the transaction was already rolled back by SQLite
        }
        throw err;
      }
    };
  }
  close() {
    // Statements outlive their prepare() call here, so free them explicitly
    // before closing — the WASM build leaks them otherwise.
    for (const stmt of this.statements) {
      try {
        stmt.finalize();
      } catch {
        // already finalized
      }
    }
    this.statements = [];
    this.raw.close();
  }
}

export function openDb(dbPath, { Database }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  migrateOutOfWal(dbPath);
  const db = new Db(new Database(dbPath));
  // The WASM build cannot use WAL, so concurrent capture (Stop hook) and
  // inject (UserPromptSubmit) serialize on the write lock instead of running
  // side by side. Both hold it only for a few milliseconds; the busy timeout
  // makes the loser wait rather than fail.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}

export function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT    NOT NULL,
      project        TEXT,
      project_name   TEXT,
      task_id        TEXT,
      user_text      TEXT    NOT NULL,
      assistant_text TEXT    NOT NULL,
      timestamp      TEXT    NOT NULL,
      created_at     REAL    NOT NULL,
      embedding      BLOB
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      user_text,
      assistant_text,
      content=memories,
      content_rowid=id,
      tokenize='trigram'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai
    AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, user_text, assistant_text)
      VALUES (new.id, new.user_text, new.assistant_text);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad
    AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, user_text, assistant_text)
      VALUES ('delete', old.id, old.user_text, old.assistant_text);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au
    AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, user_text, assistant_text)
      VALUES ('delete', old.id, old.user_text, old.assistant_text);
      INSERT INTO memories_fts(rowid, user_text, assistant_text)
      VALUES (new.id, new.user_text, new.assistant_text);
    END;

    CREATE INDEX IF NOT EXISTS idx_memories_session_timestamp
    ON memories(session_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_memories_timestamp
    ON memories(timestamp);
  `);
}

export function vecToBlob(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

function projectName(project) {
  return project ? basename(project) : "";
}

/**
 * Insert chunks without embeddings (embedding=NULL) — the fast path used by
 * the Stop hook. Duplicates (same session_id + timestamp) are skipped.
 * Returns the number of rows inserted.
 */
export function saveChunksTextOnly(db, chunks, taskId = "") {
  if (!chunks.length) return 0;
  // Dedup on (timestamp, user_text), not (session_id, timestamp): resumed
  // sessions copy the old history into a transcript with a NEW session id,
  // and the original per-message timestamps are what survive the copy.
  const exists = db.prepare(
    "SELECT COUNT(*) AS n FROM memories WHERE timestamp = ? AND user_text = ?",
  );
  const insert = db.prepare(`
    INSERT INTO memories
      (session_id, project, project_name, task_id, user_text, assistant_text, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // One saved_at for the whole session keeps time-decay consistent.
  const savedAt = Date.now() / 1000;
  let inserted = 0;
  const run = db.transaction(() => {
    for (const c of chunks) {
      if (exists.get(c.timestamp ?? "", c.user ?? "").n > 0) continue;
      insert.run(
        c.session_id ?? "",
        c.project ?? "",
        projectName(c.project ?? ""),
        taskId,
        c.user ?? "",
        c.assistant ?? "",
        c.timestamp ?? "",
        savedAt,
      );
      inserted += 1;
    }
  });
  run();
  return inserted;
}

export function pendingCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM memories WHERE embedding IS NULL").get().n;
}

/**
 * Embed up to batchSize rows where embedding IS NULL.
 * embedFn(texts) -> array of float vectors. Returns rows updated.
 */
export async function embedPending(db, embedFn, batchSize = 50) {
  const rows = db
    .prepare(
      `SELECT id, project_name, user_text, assistant_text
       FROM memories WHERE embedding IS NULL LIMIT ?`,
    )
    .all(batchSize);
  if (!rows.length) return 0;

  // Prefixing the project name improves cross-project retrieval, matching
  // how sui-memory embeds documents.
  const texts = rows.map(
    (r) => `[プロジェクト: ${r.project_name ?? ""}]\n${r.user_text}\n${r.assistant_text}`,
  );
  const vectors = await embedFn(texts);

  const update = db.prepare("UPDATE memories SET embedding = ? WHERE id = ?");
  const run = db.transaction(() => {
    rows.forEach((r, i) => update.run(vecToBlob(vectors[i]), r.id));
  });
  run();
  return rows.length;
}

const SELECT_FIELDS = `
  m.id, m.session_id, m.project, m.project_name, m.task_id,
  m.user_text, m.assistant_text, m.timestamp, m.created_at
`;

/** Float32 view over a BLOB column value, honouring the buffer offset. */
function blobToVec(blob) {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

/** Cosine distance, matching sqlite-vec's `vec_distance_cosine` semantics. */
function cosineDistance(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 1 : 1 - dot / denom;
}

/**
 * Nearest neighbours by cosine distance, ranked in JavaScript.
 *
 * A vector index (sqlite-vec) would mean loading a native SQLite extension,
 * which the WASM build cannot do. A full scan is affordable at this scale —
 * the embeddings are a plain BLOB column, so the stored format is unchanged
 * and existing databases keep working.
 */
export function vectorSearch(db, queryVec, { limit = 20, since = null, until = null } = {}) {
  const conditions = ["m.embedding IS NOT NULL"];
  const params = [];
  if (since !== null) {
    conditions.push("m.created_at >= ?");
    params.push(since);
  }
  if (until !== null) {
    conditions.push("m.created_at <= ?");
    params.push(until);
  }
  const rows = db
    .prepare(
      `SELECT ${SELECT_FIELDS}, m.embedding
       FROM memories m
       WHERE ${conditions.join(" AND ")}`,
    )
    .all(...params);

  const query = new Float32Array(queryVec);
  return rows
    .map(({ embedding, ...rest }) => ({
      ...rest,
      distance: cosineDistance(query, blobToVec(embedding)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// The trigram tokenizer can never match phrases under 3 chars, and Japanese
// has no word spaces — pull runs of 3+ chars per script class instead.
// Hiragana runs are mostly particles/inflections (noise) and are skipped.
const FTS_TOKEN_RE = /[A-Za-z0-9_\-./]{3,}|[ァ-ヴー]{3,}|[一-龥々]{3,}/g;
const FTS_MAX_TOKENS = 32;

export function buildFtsQuery(query) {
  const tokens = [];
  for (const t of query.match(FTS_TOKEN_RE) ?? []) {
    if (!tokens.includes(t)) tokens.push(t);
    if (tokens.length >= FTS_MAX_TOKENS) break;
  }
  // OR, not AND: requiring co-occurrence of every token kills recall on
  // multi-keyword queries; ranking is bm25's and RRF's job.
  if (tokens.length) return tokens.map((t) => `"${t}"`).join(" OR ");
  // Fallback for pure-hiragana queries etc.: space-split phrases.
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', '""')}"`)
    .join(" OR ");
}

export function ftsSearch(db, query, { limit = 20, since = null, until = null } = {}) {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const conditions = ["memories_fts MATCH ?"];
  const params = [match];
  if (since !== null) {
    conditions.push("m.created_at >= ?");
    params.push(since);
  }
  if (until !== null) {
    conditions.push("m.created_at <= ?");
    params.push(until);
  }
  params.push(limit);
  try {
    return db
      .prepare(
        `SELECT ${SELECT_FIELDS}, rank AS score
         FROM memories_fts
         JOIN memories m ON memories_fts.rowid = m.id
         WHERE ${conditions.join(" AND ")}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params);
  } catch {
    // An unparsable MATCH expression must not break the caller.
    return [];
  }
}

/** Aggregate stats for the time summary: totals and last session time. */
export function getStats(db) {
  return db
    .prepare(
      `SELECT COUNT(*) AS total_memories,
              MAX(created_at) AS last_session_at,
              COUNT(DISTINCT session_id) AS total_sessions
       FROM memories`,
    )
    .get();
}

/** Most recent chunks, newest first (for /memory-recall without a query). */
export function getRecent(db, limit = 20) {
  return db
    .prepare(`SELECT ${SELECT_FIELDS} FROM memories m ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
    .all(limit);
}
