// Shared helpers for the launch-team skill: roster/bus format plus pane
// discovery and input injection. The low-level pane primitives are delegated to
// transport.mjs, which drives either herdr (default) or zellij transparently --
// so this module stays multiplexer-agnostic. The delivery approach is the same
// either way: target a specific pane by id and inject input into it WITHOUT
// stealing focus (mirrors multi-agent-ff15-vscode's transport.ts).
//
// Also imported directly by the sidekick-go skill (../sidekick-go/dispatch.mjs)
// for its 2-party caller/helper roster -- the roster/bus format here is
// team-size-agnostic, so it works unmodified for that case too. Keep changes
// here backward compatible with both callers.

import fs from 'node:fs';
import path from 'node:path';
import { transport, sleepSync, PROMPT_INPUT_DELAY_MS } from './transport.mjs';

export { sleepSync, PROMPT_INPUT_DELAY_MS };

// Backward-compatible wrappers over the transport facade. The `session`
// parameter some of these still accept is retained for call-site compatibility
// (the transport resolves the active session/pane context itself).
export function zellijOnPath() {
  return transport.onPath();
}

// The session this skill operates in. Every pane targeted by id must live in the
// same session; we capture it once at launch and reuse it everywhere.
export function currentSession() {
  return transport.session();
}

// Normalize an agent id to the form used for pane names / title matching.
export function normalizeAgentId(id) {
  return String(id || '').trim().toLowerCase();
}

export function listPanes() {
  return transport.listPanes();
}

// Resolve the pane id for an agent. Prefer a cached hint (fast, survives across
// calls); fall back to matching the pane name/title we launched the agent with.
// `session` (when known, e.g. from the roster) is forwarded to the transport so
// a zellij call targets the session recorded at launch time rather than
// re-deriving it from this process's own (possibly different) environment.
export function resolvePaneId(session, agentId, hintPaneId) {
  return transport.resolvePaneId(agentId, hintPaneId, session);
}

// Deliver text into a pane's input the way a human would: type the whole block,
// pause so the prompt registers it, then press Enter.
export function sendToPane(session, paneId, text) {
  return transport.sendToPane(paneId, text, session);
}

export function readRoster(teamDir) {
  const file = path.join(teamDir, 'roster.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeRoster(teamDir, roster) {
  fs.writeFileSync(path.join(teamDir, 'roster.json'), JSON.stringify(roster, null, 2), 'utf8');
}

export function appendLog(teamDir, entry) {
  try {
    fs.appendFileSync(
      path.join(teamDir, 'log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n',
      'utf8',
    );
  } catch {
    // logging is best-effort; never fail a delivery because the log write failed
  }
}

// Compose the text that lands in a teammate's prompt. The prefix tells the
// receiving agent who it is from so it can reply to the right teammate.
export function formatMessage({ fromId, fromRole, message }) {
  const who = fromRole ? `${fromId} — ${fromRole}` : fromId;
  return `[team message from ${who}]\n${message}`;
}

// Send `message` from one agent to another (or to all teammates). Resolves the
// recipient pane id, refreshing the roster hint when it has gone stale.
export function deliverMessage({ teamDir, fromId, toId, message }) {
  const roster = readRoster(teamDir);
  // Pin the backend to whatever was actually chosen when this team/roster was
  // launched, rather than letting a fresh process (e.g. this bus.mjs CLI
  // invocation, run from a different pane) re-detect via config file/env. That
  // re-detection would pick launch-team's own transport.config.json even for a
  // sidekick-go/handoff-go roster, silently ignoring the caller skill's choice.
  if (roster.transport) transport.selectBackend(roster.transport);
  const session = roster.session || currentSession();
  if (!session) throw new Error('No multiplexer session recorded for this team and none in the environment.');

  const fromEntry = roster.agents.find((a) => a.id === normalizeAgentId(fromId));
  const fromRole = fromEntry?.role || '';
  const text = formatMessage({ fromId: normalizeAgentId(fromId), fromRole, message });

  const recipients = normalizeAgentId(toId) === 'all'
    ? roster.agents.filter((a) => a.id !== normalizeAgentId(fromId))
    : roster.agents.filter((a) => a.id === normalizeAgentId(toId));

  if (recipients.length === 0) {
    throw new Error(`No recipient matched "${toId}". Known agents: ${roster.agents.map((a) => a.id).join(', ')}`);
  }

  const results = [];
  let rosterDirty = false;
  for (const agent of recipients) {
    const paneId = resolvePaneId(session, agent.id, agent.paneId);
    if (!paneId) {
      results.push({ to: agent.id, ok: false, reason: 'pane not found (agent may have exited)' });
      appendLog(teamDir, { event: 'send', from: normalizeAgentId(fromId), to: agent.id, ok: false });
      continue;
    }
    if (paneId !== agent.paneId) {
      agent.paneId = paneId; // refresh stale hint
      rosterDirty = true;
    }
    sendToPane(session, paneId, text);
    results.push({ to: agent.id, ok: true, paneId });
    appendLog(teamDir, { event: 'send', from: normalizeAgentId(fromId), to: agent.id, ok: true });
  }
  if (rosterDirty) writeRoster(teamDir, roster);
  return results;
}
