// UserPromptSubmit hook: inject long-term memory context into the session
// (time summary + reminder on the first prompt, relevance-gated related
// memories on every prompt — see memory-engine/lib/inject.mjs).
// Silent no-op when the memory engine is not set up on this machine or the
// feature is disabled for Claude Code in the workhub app settings.
import { readPayload } from "../lib/hook-input.mjs";

try {
  const paths = await import("../engine/lib/paths.mjs");
  if (!paths.readMarker() || !paths.memoryEnabled("claude_code")) process.exit(0);

  const vault = paths.resolveVaultForHook();
  if (!vault) process.exit(0);

  const { loadSqlite } = await import("../engine/lib/deps.mjs");
  const sqlite = loadSqlite();
  if (!sqlite) process.exit(0);

  const payload = readPayload();
  const dbLib = await import("../engine/lib/db.mjs");
  const { buildInjection } = await import("../engine/lib/inject.mjs");
  const db = dbLib.openDb(paths.dbPathForVault(vault), sqlite);
  let text = "";
  try {
    dbLib.initDb(db);
    text = await buildInjection(db, {
      prompt: payload.prompt ?? "",
      sessionId: payload.session_id ?? "",
    });
    const { maybeTriggerEmbed } = await import("../engine/lib/background.mjs");
    maybeTriggerEmbed(db);
  } finally {
    db.close();
  }

  if (text) console.log(text);
} catch (err) {
  // Never fail the prompt over a memory problem.
  console.error(`[workhub-memory] inject skipped: ${err.message}`);
}
process.exit(0);
