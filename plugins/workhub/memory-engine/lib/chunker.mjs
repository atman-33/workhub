// Splits conversations into user/assistant Q&A chunks.
// - loadChunks(): Claude Code transcript (.jsonl) → chunks
// - pairMessages(): pre-extracted {role, text, timestamp} messages → chunks
//   (used by the OpenCode adapter via `cli.mjs capture-json`)
// Pairing and noise filtering live here so every agent shares one behavior.
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
 * Pair a flat [{role, text, timestamp}] message list into Q&A chunks with
 * the shared noise filters applied. Messages with empty text are skipped; a
 * user turn waits for the next assistant turn that carries text.
 *
 * Returns chunks: { user, assistant, timestamp, session_id, project }.
 */
export function pairMessages(messages, { sessionId = "", project = "" } = {}) {
  const chunks = [];
  let pendingUser = null;

  for (const msg of messages) {
    const text = (msg.text ?? "").trim();
    if (msg.role === "user") {
      // A user turn without text (tool results only) must not displace the
      // pending question: "question → N tool calls → final answer" would
      // otherwise lose the original question.
      if (text) pendingUser = { text, timestamp: msg.timestamp ?? "" };
    } else if (msg.role === "assistant") {
      if (pendingUser === null) continue;
      // Thinking-only / streaming intermediate entries have no text yet —
      // keep waiting for the real answer.
      if (!text) continue;

      const userText = pendingUser.text;
      if (
        userText.length >= MIN_USER_TEXT_LEN &&
        !NOISE_USER_PREFIXES.some((p) => userText.startsWith(p)) &&
        !NOISE_ASSISTANT_TEXTS.has(text)
      ) {
        chunks.push({
          user: userText,
          assistant: text,
          timestamp: pendingUser.timestamp,
          session_id: sessionId,
          project,
        });
      }
      pendingUser = null;
    }
  }

  return chunks;
}

/**
 * Claude Code transcript (.jsonl) → Q&A chunks. Session id and project
 * (cwd) are taken from the transcript entries themselves.
 */
export function loadChunks(transcriptPath) {
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

  let sessionId = "";
  let project = "";
  const messages = [];
  for (const entry of entries) {
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (entry.type === "user") {
      sessionId ||= entry.sessionId ?? "";
      project ||= entry.cwd ?? "";
    }
    messages.push({
      role: entry.type,
      text: extractText(entry.message?.content ?? ""),
      timestamp: entry.timestamp ?? "",
    });
  }

  return pairMessages(messages, { sessionId, project });
}
