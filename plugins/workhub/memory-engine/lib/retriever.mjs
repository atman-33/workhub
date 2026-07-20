// Hybrid retrieval: FTS5 keyword search + vector search fused with RRF
// (Reciprocal Rank Fusion), then weighted by exponential time decay.
// Port of sui-memory's retriever.py.
import { ftsSearch, vectorSearch } from "./db.mjs";
import { embedQuery } from "./embedder.mjs";

function rrfScore(rank, k = 60) {
  return 1.0 / (k + rank);
}

export function timeDecay(createdAt, halfLifeDays) {
  const elapsed = Date.now() / 1000 - createdAt;
  return 0.5 ** (elapsed / (halfLifeDays * 86400));
}

function fuse(ftsResults, vecResults, halfLifeDays, limit) {
  const merged = new Map();
  ftsResults.forEach((row, rank) => {
    const rec = merged.get(row.id) ?? { ...row, _rrf: 0 };
    rec._rrf += rrfScore(rank);
    merged.set(row.id, rec);
  });
  vecResults.forEach((row, rank) => {
    const rec = merged.get(row.id) ?? { ...row, _rrf: 0 };
    // Keep cosine distance on FTS-first records too: RRF only ranks, it
    // cannot express absolute relevance — callers gate "hit or not" on
    // distance (records found by FTS alone keep distance = null).
    rec.distance = row.distance;
    rec._rrf += rrfScore(rank);
    merged.set(row.id, rec);
  });

  const results = [...merged.values()].map((rec) => {
    const { _rrf, ...rest } = rec;
    return {
      ...rest,
      distance: rec.distance ?? null,
      score: _rrf * timeDecay(rec.created_at, halfLifeDays),
    };
  });
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Hybrid search over all time.
 * Default half-life is long (180d): explicit recall is a tool for digging up
 * *old* conversations, so old exact matches must not sink under recent noise.
 */
export async function search(db, query, { limit = 5, halfLifeDays = 180 } = {}) {
  const ftsResults = ftsSearch(db, query, { limit: 20 });
  const queryVec = await embedQuery(query);
  const vecResults = vectorSearch(db, queryVec, { limit: 20 });
  return fuse(ftsResults, vecResults, halfLifeDays, limit);
}

/**
 * Hybrid search restricted to the last `days` days. The time filter is
 * applied *inside* SQL: filtering after LIMIT lets strong out-of-window
 * matches starve the candidate pool and produce chronic empty results.
 */
export async function searchByTimerange(
  db,
  query,
  days,
  { limit = 5, halfLifeDays = 180 } = {},
) {
  const since = Date.now() / 1000 - days * 86400;
  const ftsResults = ftsSearch(db, query, { limit: 20, since });
  const queryVec = await embedQuery(query);
  const vecResults = vectorSearch(db, queryVec, { limit: 20, since });
  return fuse(ftsResults, vecResults, halfLifeDays, limit);
}

/** Last-7-days shortcut used by the inject hook (kizami's search_recent). */
export async function searchRecent(db, query, { limit = 5 } = {}) {
  return searchByTimerange(db, query, 7, { limit, halfLifeDays: 30 });
}
