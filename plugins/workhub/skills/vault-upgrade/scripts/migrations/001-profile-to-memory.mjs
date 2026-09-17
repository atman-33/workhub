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
import { existsSync, readdirSync } from "node:fs";
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

  /** What a reader should check before trusting that this worked. */
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
    ];
  },
};
