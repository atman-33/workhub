#!/usr/bin/env node
// workhub memory engine CLI.
//
//   node cli.mjs setup [--force]        one-time machine setup
//   node cli.mjs status                 setup / database state
//   node cli.mjs capture <transcript>   store a transcript's Q&A chunks
//   node cli.mjs embed-pending [--all]  vectorize rows with embedding=NULL
//   node cli.mjs recall <query> [--days N] [--limit N]   hybrid search
//   node cli.mjs recent [--limit N]     newest chunks, no query
//
// Hooks import lib/ directly; this CLI is for setup, explicit recall
// (the memory-recall skill / OpenCode), and background embedding.
import { writeFileSync, unlinkSync } from "node:fs";
import { ENGINE_HOME, LOCK_PATH, dbPathForVault, readMarker, resolveVault } from "./lib/paths.mjs";
import { loadSqlite } from "./lib/deps.mjs";

const [, , command, ...args] = process.argv;

function flag(name) {
  return args.includes(name);
}

function option(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function positional(index) {
  return args.filter((a) => !a.startsWith("--"))[index];
}

function openVaultDb() {
  const vault = resolveVault();
  if (!vault) throw new Error("vault not found (WORKHUB_VAULT / cwd / ~/.workhub/config.json)");
  const sqlite = loadSqlite();
  if (!sqlite) throw new Error("engine dependencies not installed — run: node cli.mjs setup");
  const { openDb, initDb } = awaitedDb;
  const db = openDb(dbPathForVault(vault), sqlite);
  initDb(db);
  return db;
}

// Loaded lazily below so `setup`/`status` work before deps exist.
let awaitedDb;

async function main() {
  switch (command) {
    case "setup": {
      const { runSetup } = await import("./lib/setup.mjs");
      await runSetup({ force: flag("--force") });
      return;
    }

    case "status": {
      const marker = readMarker();
      const vault = resolveVault();
      console.log(`engine home : ${ENGINE_HOME}`);
      console.log(`setup       : ${marker ? `ok (installed ${marker.installedAt}, ${marker.model})` : "NOT SET UP — run memory-setup"}`);
      console.log(`vault       : ${vault ?? "not found"}`);
      if (marker && vault && loadSqlite()) {
        awaitedDb = await import("./lib/db.mjs");
        const db = openVaultDb();
        try {
          const stats = awaitedDb.getStats(db);
          const pending = awaitedDb.pendingCount(db);
          console.log(`database    : ${dbPathForVault(vault)}`);
          console.log(`memories    : ${stats.total_memories} (sessions: ${stats.total_sessions}, pending embeddings: ${pending})`);
        } finally {
          db.close();
        }
      }
      return;
    }

    case "capture": {
      const transcript = positional(0);
      if (!transcript) throw new Error("usage: capture <transcript.jsonl> [--task <id>]");
      awaitedDb = await import("./lib/db.mjs");
      const { loadChunks } = await import("./lib/chunker.mjs");
      const chunks = loadChunks(transcript);
      const db = openVaultDb();
      try {
        const inserted = awaitedDb.saveChunksTextOnly(db, chunks, option("--task", ""));
        console.log(`captured ${inserted} new chunk(s) (parsed ${chunks.length})`);
      } finally {
        db.close();
      }
      return;
    }

    case "embed-pending": {
      awaitedDb = await import("./lib/db.mjs");
      const { embedDocs } = await import("./lib/embedder.mjs");
      // Lock out concurrent runs (the background trigger checks this too).
      writeFileSync(LOCK_PATH, String(process.pid));
      const db = openVaultDb();
      try {
        let total = 0;
        for (;;) {
          const n = await awaitedDb.embedPending(db, embedDocs, 50);
          total += n;
          if (n === 0 || !flag("--all")) break;
        }
        console.log(`embedded ${total} chunk(s)`);
      } finally {
        db.close();
        try {
          unlinkSync(LOCK_PATH);
        } catch {
          // already removed
        }
      }
      return;
    }

    case "recall": {
      const query = positional(0);
      awaitedDb = await import("./lib/db.mjs");
      const { formatMemories } = await import("./lib/format.mjs");
      const limit = Number(option("--limit", "5"));
      const days = Number(option("--days", "0"));
      const db = openVaultDb();
      try {
        if (!query) {
          const rows = awaitedDb.getRecent(db, limit || 20);
          console.log(formatMemories(rows, { header: "## 直近のメモリ", full: flag("--full") }));
          return;
        }
        const { search, searchByTimerange } = await import("./lib/retriever.mjs");
        const results = days > 0
          ? await searchByTimerange(db, query, days, { limit })
          : await search(db, query, { limit });
        const header = days > 0 ? `## 検索結果（直近${days}日: ${query}）` : `## 検索結果（全期間: ${query}）`;
        console.log(formatMemories(results, { header, full: flag("--full") }));
      } finally {
        db.close();
      }
      return;
    }

    case "recent": {
      awaitedDb = await import("./lib/db.mjs");
      const { formatMemories } = await import("./lib/format.mjs");
      const db = openVaultDb();
      try {
        const rows = awaitedDb.getRecent(db, Number(option("--limit", "20")));
        console.log(formatMemories(rows, { header: "## 直近のメモリ", full: flag("--full") }));
      } finally {
        db.close();
      }
      return;
    }

    default:
      console.error(`unknown command: ${command ?? "(none)"}`);
      console.error("commands: setup | status | capture | embed-pending | recall | recent");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[memory-engine] ${err.message}`);
  process.exitCode = 1;
});
