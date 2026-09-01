#!/usr/bin/env node
// launch-team launcher: read a team config, open one named pane per agent
// running a persistent `claude` session, write the shared roster, and kick off
// the orchestrator with the task brief. Deterministic half of the skill — keeps
// multiplexer wiring and quoting out of the LLM layer. The pane primitives are
// provided by transport.mjs (herdr by default, or zellij).
//
// Usage:
//   node launcher.mjs --config <config.json> --cwd <project dir> [--dry-run]
//
// config.json:
//   {
//     "team": "feature-x",                 // optional label
//     "brief": "full task description",    // delivered to the orchestrator
//     "agents": [
//       { "id": "orchestrator", "role": "Designer & Orchestrator",
//         "orchestrator": true, "focus": "..." },
//       { "id": "implementer", "role": "Implementer", "focus": "..." },
//       { "id": "reviewer", "role": "Reviewer", "focus": "..." }
//     ]
//   }

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeAgentId,
  writeRoster,
  deliverMessage,
  sleepSync,
} from './team-lib.mjs';
import { transport } from './transport.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUS_PATH = path.join(HERE, 'bus.mjs');
const CONFIG_PATH = path.join(HERE, 'transport.config.json');
// Give the freshly launched `claude` TUIs a moment to start before we type the
// brief into the orchestrator's prompt, so the input is not dropped.
const STARTUP_WAIT_MS = 3000;

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--config': args.config = argv[++i]; break;
      case '--cwd': args.cwd = argv[++i]; break;
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

function loadConfig(file) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`could not read/parse --config "${file}": ${e.message}`);
  }
  if (!Array.isArray(cfg.agents) || cfg.agents.length === 0) {
    fail('config.agents must be a non-empty array');
  }
  const seen = new Set();
  for (const a of cfg.agents) {
    a.id = normalizeAgentId(a.id);
    if (!a.id || !/^[a-z0-9-]+$/.test(a.id)) fail(`invalid agent id "${a.id}" (use kebab-case)`);
    if (seen.has(a.id)) fail(`duplicate agent id "${a.id}"`);
    seen.add(a.id);
    if (!a.role) a.role = a.id;
  }
  // Exactly one orchestrator: honor the flag, else promote the first agent.
  // Coerce every flag to a real boolean so ordering math stays well-defined.
  for (const a of cfg.agents) a.orchestrator = Boolean(a.orchestrator);
  let orchestrator = cfg.agents.find((a) => a.orchestrator);
  if (!orchestrator) {
    orchestrator = cfg.agents[0];
    orchestrator.orchestrator = true;
  }
  return cfg;
}

function buildRolePrompt({ agent, cfg, teamDir }) {
  const roster = cfg.agents
    .map((a) => `  - ${a.id}${a.orchestrator ? ' (orchestrator)' : ''}: ${a.role}`)
    .join('\n');
  const sendCmd = (to) =>
    `node "${BUS_PATH}" send --team "${teamDir}" --from ${agent.id} --to ${to} --message "<text>"`;

  const lines = [
    `You are a member of a Claude Code agent team named "${cfg.team || 'team'}".`,
    `Your agent id is "${agent.id}" and your role is: ${agent.role}.`,
    agent.focus ? `Your focus: ${agent.focus}` : null,
    '',
    'Team roster:',
    roster,
    '',
    '## Messaging teammates',
    'Run this command to message a teammate — it types straight into their prompt, and they act on it:',
    '',
    '```',
    sendCmd('<teammate-id>'),
    '```',
    '',
    `Broadcast to everyone else: \`node "${BUS_PATH}" broadcast --team "${teamDir}" --from ${agent.id} --message "<text>"\``,
    `See the roster anytime: \`node "${BUS_PATH}" roster --team "${teamDir}"\``,
    '',
    '## Protocol',
    '- Keep each message concise (ideally one short paragraph). For large detail, write a',
    '  file and reference its path instead of pasting it into the message.',
    '- After you send a message, end your turn so the teammate can act. Incoming messages',
    '  arrive as new input in your prompt, prefixed with the sender.',
    agent.orchestrator
      ? [
          '- You are the ORCHESTRATOR. Decompose the task, delegate concrete steps to teammates',
          '  by id, integrate their results, and drive the work to completion.',
          '- When the whole task is done, notify each teammate that work is complete and give the',
          '  user a final summary.',
        ].join('\n')
      : [
          '- Wait for instructions from the orchestrator. Do the work in your area, then report',
          '  back to the orchestrator with the result (or any blocker) via the send command.',
        ].join('\n'),
  ].filter((l) => l !== null);

  return lines.join('\n') + '\n';
}

function launchPane({ agent, cwd, rolePromptPath, dryRun }) {
  const claudeArgs = [
    '--session-id', agent.sessionId,
    '--permission-mode', 'auto',
    '--allowedTools', 'Bash(node *bus.mjs*)',
    '--append-system-prompt-file', rolePromptPath,
  ];
  try {
    return transport.splitPane({
      cwd,
      name: agent.id,
      command: 'claude',
      args: claudeArgs,
      dryRun,
    });
  } catch (e) {
    fail(`failed to launch pane for "${agent.id}": ${e.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) fail('--config <config.json> is required');
  if (!args.cwd) fail('--cwd <project dir> is required (the team works on this directory)');

  const active = transport.detect(CONFIG_PATH);
  if (!active) {
    fail('no supported multiplexer CLI found on PATH (need `herdr` or `zellij`).');
  }
  if (!transport.insideSession()) {
    fail(
      `launch-team must run inside a ${active} session.\n` +
      `  Start ${active} first, then re-run the skill from inside it.`,
    );
  }
  const session = transport.session();

  const cfg = loadConfig(args.config);
  const teamDir = path.join(os.tmpdir(), `launch-team-${(cfg.team || 'team').replace(/[^a-z0-9-]/gi, '-')}-${Date.now()}`);
  fs.mkdirSync(path.join(teamDir, 'status'), { recursive: true });

  // Assign session ids up front so role prompts and roster are consistent.
  for (const agent of cfg.agents) agent.sessionId = randomUUID();

  // Write role prompts (need the full roster, which we already know).
  for (const agent of cfg.agents) {
    agent.rolePromptPath = path.join(teamDir, `role-${agent.id}.md`);
    fs.writeFileSync(agent.rolePromptPath, buildRolePrompt({ agent, cfg, teamDir }), 'utf8');
  }

  // Persist an initial roster so bus.mjs works even before pane ids are known.
  const roster = {
    team: cfg.team || 'team',
    transport: active,
    session,
    cwd: args.cwd,
    createdAt: new Date().toISOString(),
    busPath: BUS_PATH,
    agents: cfg.agents.map((a) => ({
      id: a.id, role: a.role, orchestrator: Boolean(a.orchestrator),
      sessionId: a.sessionId, paneId: null,
    })),
  };
  writeRoster(teamDir, roster);

  // Launch workers first, orchestrator last, so every teammate pane exists by
  // the time the orchestrator starts delegating.
  const ordered = [...cfg.agents].sort((a, b) => Number(a.orchestrator) - Number(b.orchestrator));
  for (const agent of ordered) {
    const paneId = launchPane({ agent, cwd: args.cwd, rolePromptPath: agent.rolePromptPath, dryRun: args.dryRun });
    const entry = roster.agents.find((e) => e.id === agent.id);
    if (entry) entry.paneId = paneId;
  }
  writeRoster(teamDir, roster);

  const orchestrator = cfg.agents.find((a) => a.orchestrator);

  // Kick off the orchestrator with the task brief (delivered into its pane).
  if (!args.dryRun && cfg.brief && cfg.brief.trim()) {
    sleepSync(STARTUP_WAIT_MS); // let the claude TUIs finish booting
    // The role prompt already defines the orchestrator's duties; the kickoff
    // just carries the task and triggers it (single source of truth).
    const kickoff = `${cfg.brief.trim()}\n\nThis is the team's task. Begin orchestrating.`;
    try {
      deliverMessage({ teamDir, fromId: 'launcher', toId: orchestrator.id, message: kickoff });
    } catch (e) {
      console.error(`Warning: could not auto-deliver the brief to "${orchestrator.id}": ${e.message}`);
      console.error('Deliver it manually, e.g.:');
      console.error(`  node "${BUS_PATH}" send --team "${teamDir}" --from launcher --to ${orchestrator.id} --message "<brief>"`);
    }
  }

  // Summary.
  console.log(`\nlaunch-team: started ${cfg.agents.length} agents in ${active} session "${session}".`);
  console.log(`Team dir: ${teamDir}`);
  for (const a of roster.agents) {
    console.log(`  ${a.id}${a.orchestrator ? ' [orchestrator]' : ''} — ${a.role}  (pane ${a.paneId ?? 'unknown'})`);
  }
  console.log('\nThe orchestrator drives the work; watch each pane to follow along.');
  console.log(`Inspect the roster: node "${BUS_PATH}" roster --team "${teamDir}"`);
}

main();
