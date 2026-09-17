/**
 * 001 — `profile/` becomes `memory/identity/`, and the decision log becomes notes.
 *
 * `profile/` and `memory/` were the same layer described twice: the things a
 * session is told about the owner before it does anything. T-0374 kept one of
 * them, and `memory/` was the superset — same content, plus types, an index and
 * a health check.
 *
 * What makes this urgent rather than tidy is that the old layout fails
 * *silently*. `hooks/identity-inject.mjs` gates on
 * `memory/identity/decision-policy.md` and exits 0 when it is missing, so a
 * vault that upgrades the plugin without moving its files simply stops telling
 * every session who the owner is. No error, no warning, and the symptom — an
 * agent that asks things it should already know — looks like the model having a
 * bad day.
 *
 * The decision log moves too, but differently: it was one file of one-line
 * entries that was only ever grepped, which is the "reached by search" channel.
 * That is `memory/notes/`, one typed note per call.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { alreadyMigrated, deriveNotes, sourcePath } from "./lib/decision-log.mjs";

/** The three notes that are read in full every session. */
const IDENTITY_NOTES = ["about-me.md", "decision-policy.md", "strategist.md"];

const LAYERS = ["identity", "notes", "episodes"];

const rel = (p) => p.replaceAll("\\", "/");

function profileDir(vault) {
  return join(vault, "profile");
}

function identityDir(vault) {
  return join(vault, "memory", "identity");
}

/** The identity notes still sitting in the old folder. */
function pendingIdentity(vault) {
  return IDENTITY_NOTES.filter((name) => existsSync(join(profileDir(vault), name)));
}

function decisionLogPending(vault) {
  return existsSync(sourcePath(vault)) && !alreadyMigrated(vault);
}

export default {
  id: "001",
  title: "profile/ → memory/identity/, decision log → memory/notes/",
  since: "workhub plugin 0.39.0 / app 0.139.0",

  why: [
    "The owner's context used to live in `profile/`. It now lives in",
    "`memory/identity/`, and the hook that injects it exits quietly when the new",
    "path is missing — so a vault left on the old layout stops telling sessions who",
    "the owner is, without saying so. The decision log becomes one typed note per",
    "call under `memory/notes/`, where it is found by search instead of by grep.",
  ].join("\n"),

  detect(vault) {
    const identity = pendingIdentity(vault);
    const log = decisionLogPending(vault);

    if (!identity.length && !log) {
      return {
        needed: false,
        reason: existsSync(profileDir(vault))
          ? "profile/ holds nothing left to move"
          : "no profile/ folder — this vault is already on the memory/ layout",
        steps: [],
      };
    }

    const steps = [];
    for (const layer of LAYERS) {
      steps.push({ kind: "mkdir", path: join(vault, "memory", layer) });
      // The template ships these too. Git does not track an empty directory,
      // so a layer that happens to be empty would not survive a clone.
      steps.push({ kind: "write", path: join(vault, "memory", layer, ".gitkeep"), content: "" });
    }
    for (const name of identity) {
      steps.push({
        kind: "move",
        from: join(profileDir(vault), name),
        to: join(identityDir(vault), name),
      });
    }
    if (log) {
      for (const note of deriveNotes(vault)) {
        steps.push({ kind: "write", path: note.path, content: note.content });
      }
    }

    const reason = [
      identity.length ? `${identity.length} identity note(s) still in profile/` : null,
      log ? "the decision log has not been split into notes" : null,
    ]
      .filter(Boolean)
      .join("; ");

    return {
      needed: true,
      reason,
      steps,
      // Said out loud rather than done: deleting the owner's own writing is not
      // this script's call, and the notes should be committed and read before
      // the file they came from goes anywhere.
      left: [
        ...(log ? ["profile/decision-log.md — delete it once the new notes are committed"] : []),
        "profile/ — remove the folder by hand once it is empty",
        "memory/README.md — the router note arrives with the app's template update",
      ],
    };
  },

  /**
   * What a reader should check before trusting that this worked.
   *
   * The link scan is the part worth having. Moving a note does not move the
   * links into it, and Obsidian resolves `[[profile/about-me]]` to nothing
   * without complaining — the owner finds out months later, in a note they
   * happened to open. Wikilinks by bare basename are fine and are not counted;
   * only path-style references break.
   */
  verify(vault) {
    const policy = join(identityDir(vault), "decision-policy.md");
    const notesDir = join(vault, "memory", "notes");
    const notes = existsSync(notesDir)
      ? readdirSync(notesDir).filter((n) => n.endsWith(".md")).length
      : 0;
    const leftover = existsSync(profileDir(vault))
      ? readdirSync(profileDir(vault)).filter((n) => !n.startsWith("."))
      : [];

    return [
      existsSync(policy)
        ? `identity-inject will now find ${rel("memory/identity/decision-policy.md")} — the owner's context is injected again`
        : `NO decision-policy.md at ${rel("memory/identity/")} — identity injection is still silent. This vault never had one, or it is somewhere else`,
      `${notes} note(s) in memory/notes/`,
      leftover.length
        ? `profile/ still holds: ${leftover.join(", ")}`
        : "profile/ is empty",
      ...staleReferences(vault),
    ];
  },
};

/** Folders with nothing worth scanning, or nothing that should be rewritten. */
const SKIP = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  "archive", // a historical record; rewriting it would falsify it
  "memory", // the notes this migration just wrote say where they came from
  "_ai", // agent logs and indexes — records of what was true, not links anyone follows
]);

const STALE = /profile\/(about-me|decision-policy|decision-log|strategist)/;

function walk(dir, out, depth = 0) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(path, out, depth + 1);
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

function staleReferences(vault) {
  const hits = [];
  for (const path of walk(vault, [])) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!STALE.test(text)) continue;
    hits.push(rel(path.slice(vault.length + 1)));
  }
  if (!hits.length) return ["no note still points at the old profile/ paths"];
  return [
    `${hits.length} note(s) still point at profile/… — those links now resolve to nothing:`,
    ...hits.slice(0, 10).map((h) => `  ${h}`),
    ...(hits.length > 10 ? [`  …and ${hits.length - 10} more`] : []),
  ];
}
