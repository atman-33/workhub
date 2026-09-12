#!/usr/bin/env node
// @ts-check
/**
 * SessionStart hook: surface team-comms activity - but only when this working
 * directory has actually opted in.
 *
 * The rule this hook exists to enforce (design §08.1): a session that is not
 * discussing anything gets nothing. Injecting unread counts into every session
 * turns the whole mechanism into a fixed per-session cost paid in tokens and
 * attention, and the usual outcome is that everybody learns to ignore it.
 *
 * So:
 *   - no config                  -> emit nothing
 *   - config, no focused thread  -> emit nothing, except a one-line mention count
 *   - focused thread             -> that thread's unread summaries, capped
 *   - shared folder unreachable  -> one warning line, only when focused
 *
 * Always exits 0. A SessionStart hook cannot block, and a comms space being
 * offline must never be able to disturb a session that is doing other work.
 */

import { readFileSync } from "node:fs";

import {
  findThreadDir,
  getFocus,
  isDir,
  loadConfig,
  loadState,
  readThread,
  saveState,
  setFocus,
  unreadMentions,
  unreadPosts,
} from "../../scripts/lib/comms-core.mjs";

/** How many unread summaries are worth injecting before a count says it better. */
const MAX_LINES = 10;

/** Read the SessionStart payload from stdin. Returns "" when there is none. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @param {unknown} value */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string | null} additionalContext */
function emit(additionalContext) {
  const payload = additionalContext
    ? {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext,
        },
      }
    : {};
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** @param {string} stdinRaw */
function resolveProjectRoot(stdinRaw) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (stdinRaw.trim()) {
    try {
      const payload = JSON.parse(stdinRaw);
      if (payload && typeof payload.cwd === "string" && payload.cwd) return payload.cwd;
    } catch {
      // malformed stdin: fall through to cwd
    }
  }
  return process.cwd();
}

function main() {
  const projectRoot = resolveProjectRoot(readStdin());
  const config = loadConfig(projectRoot);
  if (!config) emit(null); // not set up here: stay out of the way entirely

  const state = loadState();
  const focus = getFocus(state, config.projectRoot);

  // Mentions are the one thing that crosses the opt-in line, and only as a
  // count: being called on by name and not noticing is the worst failure this
  // mechanism has. One line cannot become noise.
  let mentionCount = 0;
  if (isDir(config.commsRoot)) {
    try {
      mentionCount = unreadMentions(config, state).length;
    } catch {
      mentionCount = 0;
    }
  }

  if (!focus) {
    if (!mentionCount) emit(null);
    emit(
      `<team-comms>\n` +
        `  <mentions count="${mentionCount}" />\n` +
        `  <note>You are named in ${mentionCount} team-comms post(s) you have not read. ` +
        `Run "comms scan" to see which threads, and the team-threads skill to act on them. ` +
        `Nothing else about team-comms applies to this session unless a thread is focused.</note>\n` +
        `</team-comms>`,
    );
  }

  if (!isDir(config.commsRoot)) {
    emit(
      `<team-comms>\n` +
        `  <warning>The focused team-comms thread cannot be reached: ${xmlEscape(config.commsRoot)} ` +
        `is not available. Check that the shared drive is mounted and available offline. ` +
        `Everything else in this session is unaffected.</warning>\n` +
        `</team-comms>`,
    );
  }

  const dir = findThreadDir(config, focus.thread);
  if (!dir) {
    emit(
      `<team-comms>\n` +
        `  <warning>Focused thread ${xmlEscape(focus.thread)} was not found in the space ` +
        `(it may have been archived). Run "comms unfocus" or focus another thread.</warning>\n` +
        `</team-comms>`,
    );
  }

  const thread = readThread(dir, focus.thread);

  // A closed thread stops being a reason to inject anything. Say so once, drop
  // the focus, and be silent from the next session on.
  if (thread.state === "closed") {
    setFocus(state, config.projectRoot, null);
    saveState(state);
    emit(
      `<team-comms>\n` +
        `  <note>The focused thread "${xmlEscape(thread.title)}" is closed, so focus has been ` +
        `cleared for this directory. team-comms will stay silent here until you focus another thread.</note>\n` +
        `</team-comms>`,
    );
  }

  const unread = unreadPosts(thread, state, config.agentId);
  if (!unread.length && !mentionCount) {
    emit(
      `<team-comms>\n` +
        `  <thread id="${xmlEscape(thread.id)}" title="${xmlEscape(thread.title)}" ` +
        `state="${xmlEscape(thread.state)}" unread="0" />\n` +
        `  <note>Focused thread, nothing new. Use the team-catchup skill if you need the ` +
        `discussion so far restored into this session.</note>\n` +
        `</team-comms>`,
    );
  }

  const lines = [
    "<team-comms>",
    `  <thread id="${xmlEscape(thread.id)}" title="${xmlEscape(thread.title)}" ` +
      `state="${xmlEscape(thread.state)}" unread="${unread.length}" path="${xmlEscape(thread.path)}" />`,
  ];
  if (mentionCount) lines.push(`  <mentions count="${mentionCount}" />`);
  for (const post of unread.slice(0, MAX_LINES)) {
    lines.push(
      `  <unread from="${xmlEscape(post.person)}" kind="${xmlEscape(post.kind)}" ` +
        `at="${xmlEscape(post.created)}"${post.attachments.length ? ` attachments="${post.attachments.length}"` : ""}>` +
        `${xmlEscape(post.summary)}</unread>`,
    );
  }
  if (unread.length > MAX_LINES) {
    lines.push(
      `  <note>${unread.length - MAX_LINES} further unread post(s) not listed — ` +
        `read the thread rather than guessing.</note>`,
    );
  }
  lines.push(
    `  <how>These are summaries only. Read a post in full with "comms read ${xmlEscape(thread.id)} --full", ` +
      `or use the team-catchup skill to restore the discussion so far. Reply with the team-reply skill. ` +
      `Posts are immutable: correct something by adding a new post, never by editing one.</how>`,
    "</team-comms>",
  );
  emit(lines.join("\n"));
}

try {
  main();
} catch {
  // A hook that throws is worse than a hook that says nothing.
  emit(null);
}
