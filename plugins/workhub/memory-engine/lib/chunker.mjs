// Splits a Claude Code transcript (.jsonl) into user/assistant Q&A chunks.
// Port of sui-memory's chunker.py.
import { readFileSync } from "node:fs";

// Skip user turns shorter than this — bare acknowledgements ("ok", "はい",
// "了解") carry no recall value. Kept conservative so short real asks survive.
const MIN_USER_TEXT_LEN = 3;

// Harness-generated user turns, not actually spoken by the user; storing
// them pollutes search (they rank high while carrying zero recall value).
const NOISE_USER_PREFIXES = [
  // context-continuation summaries restate history the DB already has
  "This session is being continued from a previous conversation that ran out of context.",
  "このセッションは、コンテキストが不足したため、以前の会話から継続されています。",
  "[Request interrupted by user",
  "[SYSTEM NOTIFICATION",
  // slash-command expansions and injected reminders
  "<command-name>",
  "<local-command",
  "<system-reminder>",
  "Base directory for this skill:",
  "Continue from where you left off",
];

// Harness-generated assistant stubs with no content worth recalling.
const NOISE_ASSISTANT_TEXTS = new Set(["No response requested."]);

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === "object" && b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();
  }
  return "";
}

/**
 * Returns Q&A chunks: { user, assistant, timestamp, session_id, project }.
 */
export function loadChunks(transcriptPath) {
  const chunks = [];
  const entries = [];
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // malformed line — skip
    }
  }

  // A user turn containing only tool_result blocks must not displace the
  // pending question: "question → N tool calls → final answer" would
  // otherwise lose the original question.
  let pendingUser = null;

  for (const entry of entries) {
    const type = entry.type;
    if (type === "file-history-snapshot") continue;

    if (type === "user") {
      if (extractText(entry.message?.content ?? "")) pendingUser = entry;
    } else if (type === "assistant") {
      if (pendingUser === null) continue;

      const assistantText = extractText(entry.message?.content ?? "");
      // Thinking-only / streaming intermediate entries have no text yet —
      // keep waiting for the real answer.
      if (!assistantText) continue;

      const userText = extractText(pendingUser.message?.content ?? "");
      if (
        !userText ||
        userText.length < MIN_USER_TEXT_LEN ||
        NOISE_USER_PREFIXES.some((p) => userText.startsWith(p)) ||
        NOISE_ASSISTANT_TEXTS.has(assistantText)
      ) {
        pendingUser = null;
        continue;
      }

      chunks.push({
        user: userText,
        assistant: assistantText,
        timestamp: pendingUser.timestamp ?? "",
        session_id: pendingUser.sessionId ?? "",
        project: pendingUser.cwd ?? "",
      });
      pendingUser = null;
    }
  }

  return chunks;
}
