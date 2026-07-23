// Loads the engine's npm dependencies from ENGINE_HOME (installed there by
// `cli.mjs setup`). Callers treat a null return as "engine not set up" and
// skip silently — hooks must never break a session over a missing install.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE_HOME } from "./paths.mjs";

const engineRequire = createRequire(join(ENGINE_HOME, "package.json"));

/**
 * node-sqlite3-wasm Database constructor, or null.
 *
 * The engine deliberately uses the WebAssembly build rather than a native
 * binding: `better-sqlite3` falls back to a node-gyp source build whenever no
 * prebuilt binary matches the local Node ABI, which forces every machine to
 * install a C/C++ toolchain. The WASM build has no such dependency and still
 * ships FTS5 (with the trigram tokenizer) — the only SQLite extension the
 * engine relies on.
 */
export function loadSqlite() {
  try {
    const { Database } = engineRequire("node-sqlite3-wasm");
    return { Database };
  } catch {
    return null;
  }
}

/**
 * Dynamic-imports @huggingface/transformers from ENGINE_HOME.
 * Resolves the package's ESM entry from its own package.json instead of
 * hard-coding a dist path. Returns the module namespace, or null.
 */
export async function loadTransformers() {
  try {
    const pkgDir = join(ENGINE_HOME, "node_modules", "@huggingface", "transformers");
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const exp = pkg.exports?.["."];
    const entry =
      (typeof exp === "string" ? exp : (exp?.node?.import ?? exp?.import ?? exp?.default)) ??
      pkg.module ??
      pkg.main;
    if (!entry) return null;
    return await import(pathToFileURL(join(pkgDir, entry)).href);
  } catch {
    return null;
  }
}
