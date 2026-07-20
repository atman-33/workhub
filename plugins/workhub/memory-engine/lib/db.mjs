// SQLite storage for memory chunks: better-sqlite3 + sqlite-vec (cosine
// distance over embedding BLOBs) + FTS5 trigram index. Port of sui-memory's
// storage.py, extended with a task_id column for workhub task context.
import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";

export function openDb(dbPath, { Database, sqliteVec }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { timeout: 5000 });
  sqliteVec.load(db);
  // WAL: concurrent capture (Stop hook) and inject (UserPromptSubmit) must
  // not block each other.
  db.pragma("journal_mode = WAL");
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

export function vectorSearch(db, queryVec, { limit = 20, since = null, until = null } = {}) {
  const conditions = ["m.embedding IS NOT NULL"];
  const params = [vecToBlob(queryVec)];
  if (since !== null) {
    conditions.push("m.created_at >= ?");
    params.push(since);
  }
  if (until !== null) {
    conditions.push("m.created_at <= ?");
    params.push(until);
  }
  params.push(limit);
  return db
    .prepare(
      `SELECT ${SELECT_FIELDS}, vec_distance_cosine(m.embedding, ?) AS distance
       FROM memories m
       WHERE ${conditions.join(" AND ")}
       ORDER BY distance ASC
       LIMIT ?`,
    )
    .all(...params);
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
