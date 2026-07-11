#!/usr/bin/env node
// sidekick-go dispatcher: launch a persistent helper agent in its own pane,
// wired to message back into the CALLER's own (already-running) pane via the
// launch-team message bus. Unlike handoff-go (baton fully transferred, no
// return channel), the caller pane keeps running and can iterate with the same
// helper -- review -> fix -> re-review -- without the helper losing context
// each round.
//
// Reuses launch-team's pane/messaging primitives directly (team-lib.mjs,
// bus.mjs, transport.mjs) rather than duplicating them: the roster/bus format
// is generic enough to represent a 2-party caller/helper pair, and the shared
// transport drives herdr (default) or zellij transparently.
//
// Usage:
//   node dispatch.mjs --brief <abs path> --cwd <dir> [--role "<helper role>"] [--dry-run]

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeRoster,
  deliverMessage,
  sleepSync,
} from '../launch-team/team-lib.mjs';
import { transport } from '../launch-team/transport.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUS_PATH = path.join(HERE, '..', 'launch-team', 'bus.mjs');
const CONFIG_PATH = path.join(HERE, 'transport.config.json');
// Give the freshly launched `claude` TUI a moment to start before we type the
// kickoff message into it, so the input is not dropped (mirrors launch-team).
const STARTUP_WAIT_MS = 3000;

function parseArgs(argv) {
  const args = { role: 'Helper', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--brief': args.brief = argv[++i]; break;
      case '--cwd': args.cwd = argv[++i]; break;
      case '--role': args.role = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// Both multiplexers export a fixed id for the pane a process runs in (zellij:
// ZELLIJ_PANE_ID, herdr: HERDR_PANE_ID). Unlike the focused pane (which tracks
// live UI attention and can point at a pane the user merely clicked into), this
// is fixed to the pane that launched this script, so replies always route back
// here. transport.currentPaneId() reads the right one for the active transport.
function findCallerPaneId() {
  const id = transport.currentPaneId();
  if (!id) fail('could not identify the current pane (no pane id in the environment).');
  return id;
}

function buildHelperRolePrompt({ role, teamDir, briefPath }) {
  const sendCmd = `node "${BUS_PATH}" send --team "${teamDir}" --from helper --to caller --message "<text>"`;
  return [
    `You are "helper" -- a dedicated ${role}, launched by a teammate ("caller") for a task`,
    'you will likely be asked about MORE THAN ONCE. Unlike a one-shot subagent, you keep this',
    'same pane and session for as long as the exchange continues: retain full context of',
    'every round (earlier findings, earlier feedback) across the whole conversation.',
    '',
    `Your first task is written to a brief file. Read it in full: ${briefPath}`,
    '',
    '## Replying to caller',
    'When you have a result, send it back -- do not just print it and stop:',
    '',
    '```',
    sendCmd,
    '```',
    '',
    'Keep the message concise (one short paragraph). For large detail, write a file and',
    'reference its path instead of pasting it into the message.',
    '',
    '## Protocol',
    '- After you send a message, end your turn so caller can act on it.',
    '- caller may come back with a follow-up (e.g. "I fixed the issues, please re-review") --',
    '  it arrives as new input in this same prompt, prefixed "[team message from caller]".',
    '  Treat it as the next round of the same ongoing task, using everything you already know.',
    '- Keep cycling -- reply, wait, reply -- until caller signals the exchange is done.',
  ].join('\n') + '\n';
}

function launchHelperPane({ cwd, sessionId, rolePromptPath, dryRun }) {
  const claudeArgs = [
    '--session-id', sessionId,
    '--permission-mode', 'auto',
    '--allowedTools', 'Bash(node *bus.mjs*)',
    '--append-system-prompt-file', rolePromptPath,
  ];
  try {
    // Split off to the right and keep the caller focused so the human stays in
    // their own pane (herdr honors --no-focus; zellij focuses the new pane).
    return transport.splitPane({
      cwd,
      name: 'helper',
      command: 'claude',
      args: claudeArgs,
      direction: 'right',
      noFocus: true,
      dryRun,
    });
  } catch (e) {
    fail(`failed to launch helper pane: ${e.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.brief) fail('--brief <absolute path to the brief file> is required');
  if (!args.cwd) fail('--cwd <project dir> is required (the helper works on this directory)');

  const active = transport.detect(CONFIG_PATH);
  if (!active) {
    fail('no supported multiplexer CLI found on PATH (need `herdr` or `zellij`).');
  }
  if (!transport.insideSession()) {
    fail(
      `sidekick-go must run inside a ${active} session.\n` +
      `  Start ${active} first, then re-run the skill from inside it.`,
    );
  }
  const session = transport.session();

  const callerPaneId = findCallerPaneId();

  const teamDir = path.join(os.tmpdir(), `sidekick-go-${Date.now()}`);
  fs.mkdirSync(teamDir, { recursive: true });

  const sessionId = randomUUID();
  const roster = {
    team: 'sidekick',
    transport: active,
    session,
    cwd: args.cwd,
    createdAt: new Date().toISOString(),
    busPath: BUS_PATH,
    agents: [
      { id: 'caller', role: 'Caller', paneId: callerPaneId, orchestrator: false },
      { id: 'helper', role: args.role, sessionId, paneId: null, orchestrator: false },
    ],
  };
  writeRoster(teamDir, roster);

  const rolePromptPath = path.join(teamDir, 'role-helper.md');
  fs.writeFileSync(
    rolePromptPath,
    buildHelperRolePrompt({ role: args.role, teamDir, briefPath: args.brief }),
    'utf8',
  );

  const paneId = launchHelperPane({ cwd: args.cwd, sessionId, rolePromptPath, dryRun: args.dryRun });
  const helperEntry = roster.agents.find((a) => a.id === 'helper');
  helperEntry.paneId = paneId;
  writeRoster(teamDir, roster);

  if (!args.dryRun) {
    sleepSync(STARTUP_WAIT_MS); // let the claude TUI finish booting
    const kickoff = `Read the brief at ${args.brief} and begin.`;
    try {
      deliverMessage({ teamDir, fromId: 'caller', toId: 'helper', message: kickoff });
    } catch (e) {
      console.error(`Warning: could not auto-deliver the brief to helper: ${e.message}`);
      console.error('Deliver it manually, e.g.:');
      console.error(`  node "${BUS_PATH}" send --team "${teamDir}" --from caller --to helper --message "${kickoff}"`);
    }
  }

  console.log(`\nsidekick-go: started helper (${args.role}) in ${active} session "${session}".`);
  console.log(`Team dir: ${teamDir}`);
  console.log(`Helper pane: ${paneId ?? 'unknown'}`);
  console.log('\nFollow-up round (send another message to the same helper, once it has replied):');
  console.log(`  node "${BUS_PATH}" send --team "${teamDir}" --from caller --to helper --message "<text>"`);
}

main();
