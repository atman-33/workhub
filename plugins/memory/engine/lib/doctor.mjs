// Health check: does this install actually work, and is it recording?
//
// `status` answers "what is configured". `doctor` answers the question that
// went unanswered for 46 days: "is anything wrong?". The memory engine is
// deliberately silent — hooks swallow their errors so a session is never
// broken by them — which means the only way a problem surfaces is if something
// goes looking. This is that something.
//
// Every check returns one of three verdicts and never throws: a doctor that
// crashes on a broken install is no use on precisely the install that needs it.
import { existsSync, statSync } from "node:fs";
import { readCaptureState, queuedCount } from "./capture.mjs";
import {
  ENGINE_VERSION,
  dbPathForVault,
  engineHome,
  installedEngineDir,
  memoryEnabled,
  modelsDir,
  readMarker,
  resolveVault,
} from "./paths.mjs";

/** @typedef {{ name: string, level: "ok" | "warn" | "fail", detail: string, fix?: string }} Check */

const DAY = 86400;

function check(name, level, detail, fix) {
  return fix ? { name, level, detail, fix } : { name, level, detail };
}

function checkSetup() {
  const marker = readMarker();
  if (!marker) {
    return check(
      "setup",
      "fail",
      `no usable marker in ${engineHome()} (engine version ${ENGINE_VERSION})`,
      "run the memory-setup skill — until it succeeds every hook is a silent no-op",
    );
  }
  return check("setup", "ok", `installed ${marker.installedAt}, model ${marker.model}`);
}

function checkEngineCopy() {
  // The OpenCode plugin and any plain terminal run this copy, not the plugin
  // directory. A copy that predates a new module fails to load, and the caller
  // sees nothing (T-0366).
  const installed = installedEngineDir();
  const cli = `${installed}/cli.mjs`;
  if (!existsSync(cli)) {
    return check(
      "engine copy",
      "fail",
      `missing: ${cli}`,
      "run memory-setup — OpenCode sessions call this copy, not the plugin",
    );
  }
  return check("engine copy", "ok", installed);
}

function checkModel() {
  const models = modelsDir();
  if (!existsSync(models)) {
    return check("model cache", "warn", `missing: ${models}`, "run memory-setup");
  }
  return check("model cache", "ok", models);
}

function checkVault() {
  const vault = resolveVault();
  if (!vault) {
    return check(
      "vault",
      "fail",
      "not found",
      "set WORKHUB_VAULT, run from inside a vault, or configure vault_path in ~/.workhub/config.json",
    );
  }
  return check("vault", "ok", vault);
}

function checkAgents() {
  const off = ["claude_code", "opencode"].filter((agent) => !memoryEnabled(agent));
  if (off.length === 2) {
    return check(
      "agents",
      "warn",
      "memory is switched off for both Claude Code and OpenCode",
      "turn it back on in the workhub app's settings",
    );
  }
  if (off.length === 1) {
    return check("agents", "warn", `memory is switched off for ${off[0]}`);
  }
  return check("agents", "ok", "claude_code, opencode");
}

/** The database file, and whether its contents agree with the schema. */
function checkDatabase(vault, sqlite, dbLib) {
  const path = dbPathForVault(vault);
  if (!existsSync(path)) {
    return [check("database", "warn", `not created yet: ${path}`, "capture one session")];
  }
  if (!sqlite) {
    return [
      check("database", "fail", "node-sqlite3-wasm is not installed", "run memory-setup"),
    ];
  }
  let db;
  try {
    db = dbLib.openDb(path, sqlite);
    dbLib.initDb(db);
    const stats = dbLib.getStats(db);
    const pending = dbLib.pendingCount(db);
    const checks = [
      check(
        "database",
        "ok",
        `${stats.total_memories} memories, ${stats.total_sessions} sessions, ${pending} awaiting embedding`,
      ),
    ];
    // Un-embedded rows are normal in small numbers — the background run
    // triggers at 30 — but a backlog that never clears means the embedder is
    // failing, and search silently degrades to keyword-only.
    if (pending >= 100) {
      checks.push(
        check(
          "embeddings",
          "warn",
          `${pending} rows have no embedding`,
          "run `cli.mjs embed-pending --all` and watch for an error",
        ),
      );
    }
    return checks;
  } catch (err) {
    return [
      check("database", "fail", err.message, "check the file is readable and not held by another process"),
    ];
  } finally {
    try {
      db?.close();
    } catch {
      // nothing useful to do about a close that fails during a health check
    }
  }
}

/** Is capture actually recording, or has it quietly stopped? */
function checkCapture() {
  const state = readCaptureState();
  const queued = queuedCount();
  const checks = [];

  if (!state.lastSuccessAt) {
    checks.push(
      check(
        "capture",
        "warn",
        "no capture has ever succeeded on this machine",
        "finish a session and re-run doctor — if it stays at never, the Stop hook is not firing",
      ),
    );
  } else {
    const ageDays = Math.floor((Date.now() / 1000 - state.lastSuccessAt) / DAY);
    const stamp = new Date(state.lastSuccessAt * 1000).toISOString();
    // A fortnight of silence is either a holiday or a failure, and the two are
    // indistinguishable from here — say so rather than guess.
    checks.push(
      ageDays >= 14
        ? check(
            "capture",
            "warn",
            `last succeeded ${stamp} (${ageDays} days ago)`,
            "if you have been working in this vault since, capture is failing",
          )
        : check("capture", "ok", `last succeeded ${stamp}`),
    );
  }

  if (state.consecutiveFailures) {
    checks.push(
      check(
        "capture failures",
        "fail",
        `${state.consecutiveFailures} in a row — ${state.lastError || "no message recorded"}`,
        "run `cli.mjs capture-retry` once the cause is fixed",
      ),
    );
  }
  if (queued) {
    checks.push(
      check(
        "capture queue",
        "warn",
        `${queued} session(s) waiting to be written`,
        "run `cli.mjs capture-retry`, or just start another session — capture drains the queue",
      ),
    );
  }
  return checks;
}

function checkOpencodeLog(vault) {
  const log = `${vault}/.opencode/plugins/logs/memory.log`;
  if (!existsSync(log)) return [];
  const age = Math.floor((Date.now() - statSync(log).mtimeMs) / 1000 / DAY);
  return [
    check(
      "opencode log",
      "warn",
      `${log} has entries (last written ${age} day(s) ago)`,
      "read it — the OpenCode side only writes there when something went wrong",
    ),
  ];
}

/**
 * Run every check. `deps` is injected so the CLI owns the lazy loading of the
 * database modules and this stays a plain function.
 *
 * @returns {{ checks: Check[], worst: "ok" | "warn" | "fail" }}
 */
export function runDoctor({ sqlite = null, dbLib = null } = {}) {
  const checks = [checkSetup(), checkEngineCopy(), checkModel(), checkVault(), checkAgents()];
  const vault = resolveVault();
  if (vault) {
    if (dbLib) checks.push(...checkDatabase(vault, sqlite, dbLib));
    checks.push(...checkCapture(), ...checkOpencodeLog(vault));
  }
  const worst = checks.some((c) => c.level === "fail")
    ? "fail"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";
  return { checks, worst };
}

const SYMBOL = { ok: "ok  ", warn: "WARN", fail: "FAIL" };

/** Render the report as lines. The caller prints them. */
export function formatDoctor({ checks, worst }) {
  const width = Math.max(...checks.map((c) => c.name.length));
  const lines = checks.map((c) => `${SYMBOL[c.level]}  ${c.name.padEnd(width)}  ${c.detail}`);
  const fixes = checks.filter((c) => c.fix);
  if (fixes.length) {
    lines.push("");
    for (const c of fixes) lines.push(`  → ${c.name}: ${c.fix}`);
  }
  lines.push("");
  lines.push(
    worst === "ok"
      ? "memory is healthy."
      : worst === "warn"
        ? "memory works, but something above needs attention."
        : "memory is not working — fix the FAIL lines first.",
  );
  return lines;
}
