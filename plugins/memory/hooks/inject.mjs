// UserPromptSubmit hook: the memory context that depends on this prompt —
// the past conversations relevant to it, plus the one-line reflex reminder
// (the full text is in the SessionStart brief, which a long session compacts
// away).
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
  const { hasStore } = await import("../engine/lib/store.mjs");
  const { reflexReminder } = await import("../engine/lib/reflexes.mjs");
  // One line, every turn: the SessionStart block carries the full text, but a
  // long session compacts it away, and a reflex that has faded is not a reflex.
  const reminder = reflexReminder({ hasStore: hasStore(vault) });

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

  const out = [reminder, text].filter(Boolean).join("

");
  if (out) console.log(out);
} catch (err) {
  // Never fail the prompt over a memory problem.
  console.error(`[workhub-memory] inject skipped: ${err.message}`);
}
process.exit(0);
