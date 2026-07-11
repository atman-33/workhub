#!/usr/bin/env node
// launch-team message bus CLI. Agents run this from inside their own pane to
// talk to teammates. A message is delivered straight into the recipient's
// Claude Code prompt (via the active multiplexer's write + Enter), so the
// teammate acts on it immediately — no polling, no inbox files, no re-resume.
//
// Usage (the exact invocation is baked into each agent's role prompt):
//   node bus.mjs send      --team <dir> --from <id> --to <id|all> --message "..."
//   node bus.mjs broadcast --team <dir> --from <id> --message "..."
//   node bus.mjs roster    --team <dir>
//   node bus.mjs status    --team <dir> --from <id> --set "..."

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliverMessage, readRoster, normalizeAgentId } from './team-lib.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--team': args.team = argv[++i]; break;
      case '--from': args.from = argv[++i]; break;
      case '--to': args.to = argv[++i]; break;
      case '--message': args.message = argv[++i]; break;
      case '--set': args.set = argv[++i]; break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

function requireTeam(args) {
  if (!args.team) { console.error('Error: --team <dir> is required'); process.exit(2); }
  if (!fs.existsSync(path.join(args.team, 'roster.json'))) {
    console.error(`Error: no roster.json under --team "${args.team}"`);
    process.exit(2);
  }
}

function cmdSend(args, toOverride) {
  requireTeam(args);
  const to = toOverride ?? args.to;
  if (!args.from) { console.error('Error: --from <id> is required'); process.exit(2); }
  if (!to) { console.error('Error: --to <id|all> is required'); process.exit(2); }
  if (!args.message) { console.error('Error: --message "..." is required'); process.exit(2); }
  const results = deliverMessage({ teamDir: args.team, fromId: args.from, toId: to, message: args.message });
  for (const r of results) {
    console.log(r.ok ? `delivered -> ${r.to}` : `FAILED -> ${r.to}: ${r.reason}`);
  }
  if (results.some((r) => !r.ok)) process.exit(1);
}

function cmdRoster(args) {
  requireTeam(args);
  const roster = readRoster(args.team);
  console.log(`Team: ${roster.team}  (session: ${roster.session})`);
  for (const a of roster.agents) {
    const tag = a.orchestrator ? ' [orchestrator]' : '';
    console.log(`  ${a.id}${tag} — ${a.role}`);
  }
}

function cmdStatus(args) {
  requireTeam(args);
  if (!args.from) { console.error('Error: --from <id> is required'); process.exit(2); }
  if (!args.set) { console.error('Error: --set "..." is required'); process.exit(2); }
  const dir = path.join(args.team, 'status');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${normalizeAgentId(args.from)}.md`),
    `# ${normalizeAgentId(args.from)}\n\nUpdated: ${new Date().toISOString()}\n\n${args.set}\n`,
    'utf8',
  );
  console.log(`status updated for ${normalizeAgentId(args.from)}`);
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (sub) {
    case 'send': cmdSend(args); break;
    case 'broadcast': cmdSend(args, 'all'); break;
    case 'roster': cmdRoster(args); break;
    case 'status': cmdStatus(args); break;
    default:
      console.error('Usage: node bus.mjs <send|broadcast|roster|status> [options]');
      process.exit(2);
  }
}

// Only run the CLI when invoked directly (launcher.mjs imports the helpers).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`bus error: ${e.message}`);
    process.exit(1);
  }
}
