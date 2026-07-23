// Idempotent machine setup for the memory engine:
//   1. install npm dependencies into ENGINE_HOME
//   2. download the embedding model into ENGINE_HOME/models
//   3. initialize the vault database
//   4. ensure the DB is gitignored in the vault
//   5. write the .setup-version marker
// Safe to re-run; exits fast when the marker already matches ENGINE_VERSION.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENGINE_HOME,
  ENGINE_VERSION,
  INSTALLED_ENGINE_DIR,
  MARKER_PATH,
  dbPathForVault,
  readMarker,
  resolveVault,
} from "./paths.mjs";
import { loadSqlite } from "./deps.mjs";
import { initDb, openDb } from "./db.mjs";

// Pinned majors; bump ENGINE_VERSION when changing this set.
const DEPENDENCIES = {
  "node-sqlite3-wasm": "^0.8.59",
  "@huggingface/transformers": "^3.7.0",
};

const GITIGNORE_LINES = [
  "# workhub memory engine database (may contain sensitive conversation text)",
  "_ai/memory/memory.db",
  "_ai/memory/memory.db-wal",
  "_ai/memory/memory.db-shm",
];

function log(msg) {
  console.log(`[memory-setup] ${msg}`);
}

function installDependencies() {
  mkdirSync(ENGINE_HOME, { recursive: true });
  const pkgPath = join(ENGINE_HOME, "package.json");
  writeFileSync(
    pkgPath,
    JSON.stringify(
      { name: "workhub-memory-engine-deps", private: true, dependencies: DEPENDENCIES },
      null,
      2,
    ),
  );
  log(`installing dependencies into ${ENGINE_HOME} ...`);
  const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: ENGINE_HOME,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) throw new Error(`npm install failed (exit ${result.status})`);
}

async function warmModel() {
  log("downloading / verifying the embedding model (first run may take a while) ...");
  const { embedDocs, embedQuery, MODEL_ID } = await import("./embedder.mjs");
  await embedDocs(["セットアップ動作確認"], { localOnly: false });
  await embedQuery("セットアップ", { localOnly: false });
  log(`model ready: ${MODEL_ID}`);
}

// Copy the engine source (cli.mjs + lib/) to a version-stable location so
// callers outside the Claude plugin cache — the OpenCode plugin, plain
// terminals — don't depend on the versioned plugin directory. Refreshed on
// every setup run.
function installEngineCopy() {
  const sourceDir = dirname(dirname(fileURLToPath(import.meta.url)));
  // Re-running setup from the installed copy itself: nothing to refresh.
  if (sourceDir === INSTALLED_ENGINE_DIR) return;
  rmSync(INSTALLED_ENGINE_DIR, { recursive: true, force: true });
  mkdirSync(INSTALLED_ENGINE_DIR, { recursive: true });
  cpSync(join(sourceDir, "cli.mjs"), join(INSTALLED_ENGINE_DIR, "cli.mjs"));
  cpSync(join(sourceDir, "lib"), join(INSTALLED_ENGINE_DIR, "lib"), { recursive: true });
  log(`engine copy installed: ${INSTALLED_ENGINE_DIR}`);
}

function ensureGitignore(vault) {
  const path = join(vault, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current.includes("_ai/memory/memory.db")) return;
  const block = `${GITIGNORE_LINES.join("\n")}\n`;
  appendFileSync(path, current.endsWith("\n") || current === "" ? block : `\n${block}`);
  log(`added memory.db entries to ${path}`);
}

export async function runSetup({ force = false } = {}) {
  if (!force && readMarker() && loadSqlite()) {
    log("already set up (marker matches ENGINE_VERSION) — nothing to do. Use --force to redo.");
    return true;
  }

  const vault = resolveVault();
  if (!vault) {
    throw new Error(
      "vault not found — set WORKHUB_VAULT, run from inside a vault, or configure vault_path in ~/.workhub/config.json",
    );
  }

  installDependencies();

  const sqlite = loadSqlite();
  if (!sqlite) throw new Error("dependencies installed but node-sqlite3-wasm failed to load");

  const db = openDb(dbPathForVault(vault), sqlite);
  try {
    initDb(db);
    log(`database ready: ${dbPathForVault(vault)}`);
  } finally {
    db.close();
  }

  installEngineCopy();
  ensureGitignore(vault);
  await warmModel();

  writeFileSync(
    MARKER_PATH,
    JSON.stringify(
      {
        version: ENGINE_VERSION,
        model: (await import("./embedder.mjs")).MODEL_ID,
        node: process.version,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  log("setup complete.");
  return true;
}
