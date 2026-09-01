#!/usr/bin/env node
// handoff-go dispatcher: detect the environment, compose the next agent's
// initial prompt, and launch a fresh `claude` that continues from a handoff
// document. Deterministic half of the skill — keeps the branchy detection,
// fallback chain, and shell quoting out of the stochastic (LLM) layer.
//
// The multiplexer wiring is delegated to the shared transport.mjs (imported
// from the sibling launch-team skill), which drives either herdr (default) or
// zellij transparently — so this skill works with whichever one is in use.
//
// Usage:
//   node dispatch.mjs --doc <abs path> --instructions <text> [--cwd <dir>]
//                     [--layout pane|tab] [--dry-run]
//
// Modes (auto-detected, with fallback A -> C and B -> C):
//   A in-session : already inside a multiplexer -> split a pane (or new tab) running claude
//   B new-window : multiplexer + a terminal     -> open a new terminal hosting it + claude
//   C manual     : neither                       -> print a paste-ready `claude` command

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transport } from '../launch-team/transport.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, 'transport.config.json');

function parseArgs(argv) {
  const args = { layout: 'pane', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--doc': args.doc = argv[++i]; break;
      case '--instructions': args.instructions = argv[++i]; break;
      case '--cwd': args.cwd = argv[++i]; break;
      case '--layout': args.layout = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

function buildPrompt({ doc, instructions }) {
  const extra = (instructions && instructions.trim()) ? `\n\nAdditional instructions: ${instructions.trim()}` : '';
  return `Read the handoff document at ${doc} and continue the work it describes. `
    + `Invoke the skills listed in its "suggested skills" section.${extra}`;
}

// A new pane (or tab) inside the current multiplexer session running claude.
function dispatchInSession({ cwd, layout, prompt, dryRun }) {
  try {
    transport.splitPane({
      cwd,
      name: 'handoff-go',
      command: 'claude',
      args: [prompt],
      direction: 'right',
      newTab: layout === 'tab',
      dryRun,
    });
    return 0;
  } catch (e) {
    console.error(`Mode A error: ${e.message}`);
    return 1;
  }
}

// A new terminal window hosting a one-pane multiplexer session running claude.
function dispatchNewWindow({ cwd, prompt, dryRun }) {
  return transport.spawnStandaloneSession({ cwd, prompt, dryRun });
}

// Mode C: never fail — print a paste-ready command and the document path.
function dispatchManual({ doc, prompt }) {
  console.log('\nno multiplexer in use — run the next agent manually:\n');
  console.log(`  claude ${JSON.stringify(prompt)}\n`);
  console.log(`Handoff document: ${doc}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.doc) {
    console.error('Error: --doc <absolute path> is required');
    process.exit(2);
  }
  const cwd = args.cwd ?? (() => {
    const fallback = process.cwd();
    if (fallback.includes('.claude') && fallback.includes('plugins')) {
      console.warn(
        'Warning: --cwd was not supplied and the current directory looks like a plugin cache path.\n' +
        `  cwd: ${fallback}\n` +
        '  Pass --cwd <project-dir> to set the correct working directory for the next agent.'
      );
    }
    return fallback;
  })();
  const prompt = buildPrompt(args);
  const active = transport.detect(CONFIG_PATH);

  // A: already inside a live multiplexer session
  if (active && transport.insideSession()) {
    const code = dispatchInSession({ cwd, layout: args.layout, prompt, dryRun: args.dryRun });
    if (code === 0) {
      console.log(`Dispatched (mode A, ${args.layout}) into the current ${active} session.`);
      return;
    }
    console.error('Mode A failed; falling back to manual command.');
    dispatchManual({ doc: args.doc, prompt });
    return;
  }

  // B: multiplexer CLI available + a terminal launcher
  if (active && transport.hasTerminalLauncher()) {
    const code = dispatchNewWindow({ cwd, prompt, dryRun: args.dryRun });
    if (code === 0) {
      console.log(`Dispatched (mode B) into a new terminal window (${active}).`);
      return;
    }
    console.error('Mode B failed; falling back to manual command.');
  }

  // C: manual fallback
  dispatchManual({ doc: args.doc, prompt });
}

main();
