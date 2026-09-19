/**
 * 002 — `_ai/memory/` becomes `_ai/state/`.
 *
 * `_ai/memory/` held session markers, the tidy pending list, edit snapshots,
 * soft-delete trash and the memory engine's SQLite database — none of it
 * knowledge, all of it app/agent working data. The name collided with the
 * unrelated `memory/` knowledge layer at the vault root, which is confusing
 * enough on its own that T-0390 renamed the folder rather than live with it.
 *
 * Every reader and writer in the app and the plugins already resolves this
 * folder through a small fallback helper (`_ai/state/` if it exists, else
 * `_ai/memory/`, else `_ai/state/`), so nothing breaks silently while a vault
 * has not run this migration yet — unlike 001, which the identity-inject hook
 * gated on with no fallback at all. Running it is still worth doing: every
 * fallback check is one more place for the old name to keep meaning something,
 * and a vault that never migrates carries both folders forever.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function memoryDir(vault) {
  return join(vault, "_ai", "memory");
}

function stateDir(vault) {
  return join(vault, "_ai", "state");
}

/**
 * Every file still under `_ai/memory/`, relative to it, recursing into
 * subfolders (`mindmap-snapshots/`, `schedule-trash/`, `sessions/`, …).
 * `.gitkeep` is not counted — it is the template's placeholder for an empty
 * folder, never the owner's or the app's own data.
 */
function pendingFiles(vault) {
  const root = memoryDir(vault);
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir, relBase) => {
    for (const name of readdirSync(dir)) {
      if (name === ".gitkeep") continue;
      const abs = join(dir, name);
      const rel = relBase ? join(relBase, name) : name;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out;
}

export default {
  id: "002",
  title: "_ai/memory/ → _ai/state/",
  since: "workhub plugin 0.43.0 / app 0.144.0",

  why: [
    "`_ai/memory/` held session markers, the tidy pending list, edit",
    "snapshots, soft-delete trash and the memory engine's database — app and",
    "agent working data, not knowledge. Its name collided with the unrelated",
    "`memory/` knowledge layer at the vault root, so T-0390 renamed it to",
    "`_ai/state/`. Every reader already falls back to the old name when the",
    "new one is missing, so nothing is silently broken by leaving this vault",
    "as it is — but a vault that never runs this keeps both folders forever.",
  ].join("\n"),

  detect(vault) {
    const files = pendingFiles(vault);
    if (!files.length) {
      return {
        needed: false,
        reason: existsSync(memoryDir(vault))
          ? "_ai/memory/ holds nothing left to move"
          : "no _ai/memory/ folder — this vault is already on the _ai/state/ layout",
        steps: [],
      };
    }

    const steps = [
      { kind: "mkdir", path: stateDir(vault) },
      ...files.map((rel) => ({
        kind: "move",
        from: join(memoryDir(vault), rel),
        to: join(stateDir(vault), rel),
      })),
    ];

    return {
      needed: true,
      reason: `${files.length} file(s) still in _ai/memory/`,
      steps,
      left: [
        "_ai/memory/ — remove the empty folder by hand once you are happy",
        "_ai/memory/memory.db, -wal, -shm — gitignored under the old path too; " +
          "delete them once the app confirms it is reading from _ai/state/",
      ],
    };
  },

  /** How many files ended up where, and whether anything is still stranded. */
  verify(vault) {
    const stateCount = existsSync(stateDir(vault))
      ? readdirSync(stateDir(vault)).filter((n) => n !== ".gitkeep").length
      : 0;
    const leftover = pendingFiles(vault);
    return [
      `${stateCount} top-level entr${stateCount === 1 ? "y" : "ies"} in _ai/state/`,
      leftover.length
        ? `_ai/memory/ still holds: ${leftover.join(", ")}`
        : "_ai/memory/ holds nothing left to move",
    ];
  },
};
