// PreCompact hook: write this thread's checkpoint before the context goes.
//
// Compaction is a predictable amnesia, which makes it the one moment worth
// spending a write on. What the session worked out and never wrote down is
// lost at that point, and the session that continues starts guessing at ground
// it already covered.
//
// The note is extractive: it records the thread's own prompts and leaves the
// prose for a session that has a model to hand (`memory-reflect`). A rough
// checkpoint that exists beats a good one that was never written because the
// hook took too long.
//
// One note per thread, rewritten rather than appended, so a later reader gets
// the current understanding instead of a transcript of how it was reached.
import { readPayload } from "../lib/hook-input.mjs";
import { readMarker as readSessionMarker, sessionKey } from "../lib/session-marker-read.mjs";

try {
  const paths = await import("../engine/lib/paths.mjs");
  if (!paths.readMarker() || !paths.memoryEnabled("claude_code")) process.exit(0);

  const vault = paths.resolveVaultForHook();
  if (!vault) process.exit(0);

  const { hasStore } = await import("../engine/lib/store.mjs");
  // No memory folder yet: the vault has not been given one, and creating it
  // from a hook would put a folder somewhere the owner never asked for.
  if (!hasStore(vault)) process.exit(0);

  const payload = readPayload();
  const thread = sessionKey(payload.session_id);
  const marker = readSessionMarker(vault, thread);
  const task = marker?.id ?? "";

  const { extractTail, writeCheckpoint } = await import("../engine/lib/checkpoint.mjs");
  const prompts = extractTail(payload.transcript_path ?? "");
  if (!prompts.length) process.exit(0);

  const title = task ? `${task} セッション` : (prompts[0] ?? "").slice(0, 48) || "セッション";
  const { path, rewritten } = writeCheckpoint(vault, {
    title,
    thread,
    task,
    status: "open",
    summary: prompts.at(-1),
    context: prompts.slice(0, -1),
    next_step: ["(コンテキスト圧縮前の自動記録。次の手は未記入)"],
  });

  // Anything that writes to the record says so. Something that changes it
  // silently is indistinguishable from something that is broken.
  console.error(`[workhub-memory] checkpoint ${rewritten ? "updated" : "written"}: ${path}`);
} catch (err) {
  console.error(`[workhub-memory] checkpoint skipped: ${err.message}`);
}
process.exit(0);
