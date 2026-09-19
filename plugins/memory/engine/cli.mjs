#!/usr/bin/env node
// workhub memory engine CLI.
//
//   node cli.mjs setup [--force]        one-time machine setup
//   node cli.mjs status                 setup / database state
//   node cli.mjs doctor                 full health check (exit 1 on failure)
//   node cli.mjs validate <path...>     check notes against their type (warns only)
//   node cli.mjs new <type> [title]     print a blank note of that type
//   node cli.mjs capture <transcript>   store a transcript's Q&A chunks
//   node cli.mjs capture-json           store chunks from stdin JSON
//                                       {session_id, project, task_id?,
//                                        messages: [{role, text, timestamp}]}
//   node cli.mjs inject                 print the injection block for stdin
//                                       JSON {prompt, session_id}
//   node cli.mjs embed-pending [--all]  vectorize rows with embedding=NULL
//   node cli.mjs recall <query> [--days N] [--limit N]   hybrid search
//   node cli.mjs recent [--limit N]     newest chunks, no query
//   node cli.mjs notes [terms...] [--type T] [--status S] [--all] [--archive]
//                      [--limit N]      search memory/notes/ (the durable,
//                                       distilled record — recall searches
//                                       the verbatim conversation instead)
//   node cli.mjs capture-retry          re-try transcripts queued by a busy
//                                       database (capture drains it too)
//   node cli.mjs reflect-done           record that memory-reflect just ran
//
// Claude Code hooks import lib/ directly; this CLI serves setup, explicit
// recall (the memory-recall skill), background embedding, and the OpenCode
// plugin (capture-json / inject against the engine copy in
// ~/.workhub/memory-engine/engine).
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { readMarker as readSessionMarker, sessionKey } from "../lib/session-marker-read.mjs";
import {
  ENGINE_HOME,
  LOCK_PATH,
  dbPathForVault,
  legacyDbStranded,
  readMarker,
  resolveVault,
  strandedDbNotice,
} from "./lib/paths.mjs";
import { loadSqlite } from "./lib/deps.mjs";

/** Thrown by {@link openVaultDb} when the vault's memory is stranded under
 * the pre-T-0392 `_ai/memory/` folder — a signal to no-op, not a failure. */
class StrandedDbError extends Error {}

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
  // A vault that has not run vault-upgrade's migration 002 still has its real
  // database under `_ai/memory/`. Opening `_ai/state/memory.db` here would
  // silently create a second, empty one instead of surfacing that (T-0392).
  if (legacyDbStranded(vault)) throw new StrandedDbError(strandedDbNotice());
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
      if (vault && legacyDbStranded(vault)) {
        console.log(`database    : stranded under _ai/memory/ — run vault-upgrade migration 002`);
      } else if (marker && vault && loadSqlite()) {
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
      // Capture health is reported even when the database cannot be opened —
      // "is it still recording?" is exactly the question an unopenable
      // database needs answered (T-0366).
      const { readCaptureState, queuedCount } = await import("./lib/capture.mjs");
      const state = readCaptureState();
      const queued = queuedCount();
      const stamp = (t) => (t ? new Date(t * 1000).toISOString() : "never");
      console.log(`last capture: ${stamp(state.lastSuccessAt)}`);
      if (queued || state.consecutiveFailures) {
        console.log(
          `capture     : ${queued} queued, ${state.consecutiveFailures ?? 0} consecutive failure(s)` +
            (state.lastError ? ` — ${state.lastError}` : ""),
        );
      } else {
        console.log("capture     : healthy");
      }
      return;
    }

    case "doctor": {
      const { runDoctor, formatDoctor } = await import("./lib/doctor.mjs");
      const sqlite = loadSqlite();
      // The database checks need the modules; everything else has to work
      // without them, because "the dependencies are missing" is one of the
      // things doctor exists to report.
      let dbLib = null;
      if (sqlite) {
        try {
          dbLib = await import("./lib/db.mjs");
        } catch {
          dbLib = null;
        }
      }
      const report = runDoctor({ sqlite, dbLib });
      for (const line of formatDoctor(report)) console.log(line);
      // Non-zero on failure so a script or a hook can act on it; a warning is
      // still a working install and must not fail a caller.
      if (report.worst === "fail") process.exitCode = 1;
      return;
    }

    case "validate": {
      // Warns, never fails: a store whose writes can be rejected stops being
      // written to, and an empty memory is worse than an untidy one. The exit
      // code stays 0 even with findings — `--strict` is for a caller that has
      // decided otherwise for itself.
      const { readFileSync: read } = await import("node:fs");
      const { parseNote } = await import("./lib/note.mjs");
      const { validateNote } = await import("./lib/schema.mjs");
      const files = args.filter((a) => !a.startsWith("--"));
      if (!files.length) throw new Error("usage: validate <path> [path...] [--strict]");

      let total = 0;
      for (const file of files) {
        let findings;
        let type;
        try {
          ({ type, findings } = validateNote(parseNote(read(file, "utf8"))));
        } catch (err) {
          console.log(`${file}: unreadable — ${err.message}`);
          total += 1;
          continue;
        }
        if (!findings.length) {
          console.log(`${file}: ok (${type})`);
          continue;
        }
        console.log(`${file}${type ? ` (${type})` : ""}`);
        for (const f of findings) console.log(`  warn  ${f.field}: ${f.message}`);
        total += findings.length;
      }
      if (total) console.log(`
${total} finding(s) — none of them block anything.`);
      if (total && flag("--strict")) process.exitCode = 1;
      return;
    }

    case "new": {
      const { templateFor } = await import("./lib/schema.mjs");
      const type = positional(0);
      if (!type) throw new Error("usage: new <decision|session|lesson> [title]");
      console.log(templateFor(type, positional(1) ?? "<title>"));
      return;
    }

    case "capture": {
      const transcript = positional(0);
      if (!transcript) throw new Error("usage: capture <transcript.jsonl> [--task <id>]");
      awaitedDb = await import("./lib/db.mjs");
      const { loadChunks } = await import("./lib/chunker.mjs");
      const { captureTranscript } = await import("./lib/capture.mjs");
      const result = captureTranscript(
        { openDb: openVaultDb, loadChunks, saveChunks: awaitedDb.saveChunksTextOnly },
        transcript,
        option("--task", ""),
      );
      if (result.drained) console.log(`recovered ${result.drained} chunk(s) from the retry queue`);
      console.log(
        result.queued
          ? "database busy — transcript queued for the next capture"
          : `captured ${result.inserted} new chunk(s)`,
      );
      return;
    }

    case "capture-retry": {
      awaitedDb = await import("./lib/db.mjs");
      const { loadChunks } = await import("./lib/chunker.mjs");
      const { drainQueue, queuedCount } = await import("./lib/capture.mjs");
      const before = queuedCount();
      const written = drainQueue({
        openDb: openVaultDb,
        loadChunks,
        saveChunks: awaitedDb.saveChunksTextOnly,
      });
      console.log(`queued ${before} -> ${queuedCount()}, wrote ${written} chunk(s)`);
      return;
    }

    case "capture-json": {
      // Chunk source for agents without Claude-style transcripts (OpenCode):
      // stdin carries {session_id, project, task_id?, messages}.
      const input = JSON.parse(readFileSync(0, "utf8"));
      awaitedDb = await import("./lib/db.mjs");
      const { pairMessages } = await import("./lib/chunker.mjs");
      const chunks = pairMessages(input.messages ?? [], {
        sessionId: input.session_id ?? "",
        project: input.project ?? "",
      });
      // Falls back to the marker of the session this CLI is running in.
      // OpenCode exports no session id, so its sessions all share the
      // `default` marker — the same bucket `task-cli start` wrote to there,
      // which is why the lookup deliberately ignores `input.session_id`.
      const taskId = input.task_id || readSessionMarker(resolveVault(), sessionKey())?.id || "";
      // No transcript file to re-read later, so a busy database can only be
      // retried here, not queued — but health is still recorded, or `doctor`
      // cannot tell a working OpenCode capture from a broken one (T-0371).
      const { captureChunks } = await import("./lib/capture.mjs");
      const inserted = captureChunks(
        { openDb: openVaultDb, saveChunks: awaitedDb.saveChunksTextOnly },
        chunks,
        taskId,
      );
      console.log(`captured ${inserted} new chunk(s) (parsed ${chunks.length})`);
      const { maybeTriggerEmbed } = await import("./lib/background.mjs");
      const embedDb = openVaultDb();
      try {
        maybeTriggerEmbed(embedDb);
      } finally {
        embedDb.close();
      }
      return;
    }

    case "inject": {
      // Prints the injection block for stdin JSON {prompt, session_id};
      // prints nothing when there is nothing worth injecting.
      const input = JSON.parse(readFileSync(0, "utf8"));
      const { firstPromptOf, reflectDueLine, setupTime } = await import("./lib/reflect.mjs");
      // A stranded vault has no usable database — do not let openVaultDb()'s
      // guard swallow this silently: the OpenCode path has no SessionStart
      // brief, so the first prompt of the session is the only place this can
      // reach the agent (T-0392).
      const vault = resolveVault();
      if (vault && legacyDbStranded(vault)) {
        if (firstPromptOf(input.session_id ?? "")) console.log(strandedDbNotice());
        return;
      }
      awaitedDb = await import("./lib/db.mjs");
      const { buildInjection } = await import("./lib/inject.mjs");
      const db = openVaultDb();
      try {
        // OpenCode has no SessionStart brief, so the reflect reminder rides
        // the first prompt of each session instead (T-0386). Claude Code gets
        // it from the brief and never calls this command.
        const due = firstPromptOf(input.session_id ?? "")
          ? reflectDueLine(awaitedDb.getStats(db), { since: setupTime() })
          : "";
        const text = await buildInjection(db, {
          prompt: input.prompt ?? "",
          sessionId: input.session_id ?? "",
        });
        const out = [due, text].filter(Boolean).join("\n\n");
        if (out) console.log(out);
        const { maybeTriggerEmbed } = await import("./lib/background.mjs");
        maybeTriggerEmbed(db);
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

    case "notes": {
      // Needs no database and no dependencies: notes are Markdown, so this
      // works on a machine where setup never ran.
      const vault = resolveVault();
      if (!vault) throw new Error("vault not found (WORKHUB_VAULT / cwd / ~/.workhub/config.json)");
      const valued = new Set(["--type", "--status", "--limit"]);
      const terms = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
      const { searchNotes } = await import("./lib/store.mjs");
      const { formatNotes } = await import("./lib/format.mjs");
      const filters = { type: option("--type", undefined), status: option("--status", undefined) };
      const hits = searchNotes(vault, {
        text: terms.join(" "),
        ...filters,
        all: flag("--all"),
        archive: flag("--archive"),
      });
      const limit = Number(option("--limit", "10"));
      console.log(formatNotes(hits.slice(0, limit), { vault, total: hits.length, terms, filters }));
      return;
    }

    case "reflect-done": {
      // The last step of the memory-reflect skill: stamp when it ran, so the
      // brief stops asking for it for another week (T-0386).
      const { markReflected } = await import("./lib/reflect.mjs");
      const at = markReflected();
      console.log(`reflect recorded at ${new Date(at * 1000).toISOString()}`);
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
      console.error(
        "commands: setup | status | capture | capture-json | inject | embed-pending | recall | recent | notes | reflect-done",
      );
      process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof StrandedDbError) {
    // Detected, not created: memory is waiting on the vault-upgrade
    // migration, so every DB-creating command no-ops rather than starting a
    // fresh, empty database (T-0392).
    console.error(err.message);
    return;
  }
  console.error(`[memory-engine] ${err.message}`);
  process.exitCode = 1;
});
