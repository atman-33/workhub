// Multiplexer transport abstraction for the launch-team / sidekick-go /
// handoff-go skills. These skills coordinate agents by targeting a specific
// pane by id and injecting input into it WITHOUT stealing focus. Historically
// that was zellij-only; this module lets the same skills drive either herdr
// (the default) or zellij transparently.
//
// This file is the single source of truth for the transport primitives: it is
// imported by launch-team/team-lib.mjs (and thus bus.mjs), by
// launch-team/launcher.mjs, by ../sidekick-go/dispatch.mjs, and by
// ../handoff-go/dispatch.mjs. Do not duplicate it -- the other skills import
// this copy so a fix here reaches all three.
//
// Field-name note (herdr): the JSON emitted by `herdr pane list` / `pane
// current` / `agent start` uses snake_case keys -- `pane_id`, `workspace_id`,
// `tab_id`, `focused`, `agent_status`, `name`, `agent`. This was verified
// empirically against a live herdr session (pane_id shaped like "w1:p1"; the
// new pane from `agent start` arrives at result.agent.pane_id). herdr also
// exports HERDR_PANE_ID / HERDR_WORKSPACE_ID / HERDR_TAB_ID into each pane's
// environment (analogous to zellij's ZELLIJ_PANE_ID / ZELLIJ_SESSION_NAME),
// which we use for caller-pane and session detection.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROMPT_INPUT_DELAY_MS = 500;

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Default config file: the launch-team copy. Callers that own their own config
// (sidekick-go, handoff-go) pass their path explicitly to detect().
const DEFAULT_CONFIG_PATH = path.join(HERE, 'transport.config.json');

// Synchronous sleep so the write -> Enter sequence is paced deterministically
// without turning everything async (mirrors the proven reference impl).
export function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

function normId(id) {
  return String(id || '').trim().toLowerCase();
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error,
  };
}

function cliOnPath(cmd) {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [cmd], { stdio: 'ignore' })
    : spawnSync('which', [cmd], { stdio: 'ignore' });
  return probe.status === 0;
}

function quoteArgs(args) {
  return args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

function logCmd(cmd, args) {
  console.log(`[dry-run] ${cmd} ${quoteArgs(args)}`);
}

// zellij decorates displayed pane titles (e.g. a leading spinner glyph). Match
// on the agent id robustly: strip leading non-alphanumeric decoration, then
// accept an exact or token match.
function titleMatches(title, target) {
  const t = String(title || '').toLowerCase();
  const cleaned = t.replace(/^[^a-z0-9]+/, '').trim();
  if (cleaned === target) return true;
  const escaped = target.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`).test(t);
}

// Resolve the pane id for an agent given a normalized pane list. Prefer a
// cached hint (fast, survives across calls); fall back to matching the pane
// name/title the agent was launched with. Shared by both backends.
function resolvePaneIdFrom(panes, agentId, hintId) {
  const target = normId(agentId);
  if (hintId && panes.some((p) => p.id === hintId)) return hintId;
  for (const pane of panes) {
    if (!pane.live) continue;
    const cmd = String(pane.command || '').toLowerCase();
    if (titleMatches(pane.title, target) || cmd.includes(`--name ${target}`)) {
      if (pane.id) return pane.id;
    }
  }
  return null;
}

// Pick a terminal launcher for a standalone (mode B) session spawn. Returns a
// function (cmd, args) => { status } that opens the window NON-BLOCKINGLY, or
// null when none is available.
//
// The window is opened with a detached, unref'd `spawn` (NOT a blocking
// `spawnSync(..., { stdio: 'inherit' })`). Foreground terminal emulators (xterm,
// alacritty/kitty with `-e`, etc.) do not return from a blocking invocation
// until the user closes the window -- which would prevent the caller's
// subsequent sleep + agent-injection step from ever running while the window is
// open. Returning immediately lets the caller proceed to sleep-then-inject as
// intended. Since the child is detached we cannot observe its exit status here;
// we report success when a pid was assigned (i.e. the process was spawned).
function launchDetached(cmd, args) {
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
    return { status: child.pid ? 0 : 1 };
  } catch {
    return { status: 1 };
  }
}

function terminalLauncher() {
  if (process.platform === 'win32') {
    if (cliOnPath('wt')) {
      return (cmd, cmdArgs) => launchDetached('wt', ['new-tab', '--', cmd, ...cmdArgs]);
    }
    return null;
  }
  const term = process.env.TERMINAL;
  const candidates = [term, 'x-terminal-emulator', 'gnome-terminal', 'konsole', 'kitty', 'alacritty', 'wezterm', 'xterm'].filter(Boolean);
  for (const t of candidates) {
    if (cliOnPath(t)) {
      return (cmd, cmdArgs) => launchDetached(t, ['-e', cmd, ...cmdArgs]);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// zellij backend
// ---------------------------------------------------------------------------

const zellijBackend = {
  name: 'zellij',

  onPath() {
    return cliOnPath('zellij');
  },

  insideSession() {
    return Boolean(process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME);
  },

  session() {
    return process.env.ZELLIJ_SESSION_NAME || null;
  },

  currentPaneId() {
    const raw = process.env.ZELLIJ_PANE_ID;
    if (!raw) return null;
    return /^\d+$/.test(raw) ? `terminal_${raw}` : raw;
  },

  _run(args, sessionOverride) {
    // Prefer an explicitly-provided session (e.g. roster.session recorded at
    // launch time) over live env re-derivation, so a roster-driven call in a
    // fresh process targets the session the team was launched in even under
    // nested zellij / a differently-attached client.
    const session = sessionOverride || this.session();
    return run('zellij', session ? ['--session', session, ...args] : args);
  },

  _normalizePane(p) {
    let id = null;
    if (typeof p.id === 'string' && p.id.length > 0) id = p.id;
    else if (typeof p.id === 'number') id = `terminal_${p.id}`;
    let command = '';
    if (typeof p.pane_command === 'string' && p.pane_command.length > 0) command = p.pane_command;
    else if (typeof p.terminal_command === 'string' && p.terminal_command.length > 0) command = p.terminal_command;
    const live = !(p.exited || p.is_plugin || p.is_selectable === false);
    return { id, title: p.title, command, live };
  },

  listPanes(sessionOverride) {
    const r = this._run(['action', 'list-panes', '--json'], sessionOverride);
    if (r.status !== 0) {
      throw new Error(`zellij list-panes failed: ${r.stderr.trim() || r.error?.message || 'unknown error'}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      throw new Error('Could not parse zellij pane metadata (list-panes --json).');
    }
    if (!Array.isArray(parsed)) throw new Error('Unexpected zellij pane metadata shape.');
    return parsed.filter((p) => p && typeof p === 'object').map((p) => this._normalizePane(p));
  },

  resolvePaneId(agentId, hintPaneId, sessionOverride) {
    const hint = hintPaneId ? (/^\d+$/.test(hintPaneId) ? `terminal_${hintPaneId}` : hintPaneId) : null;
    return resolvePaneIdFrom(this.listPanes(sessionOverride), agentId, hint);
  },

  sendToPane(paneId, text, sessionOverride) {
    const write = this._run(['action', 'write-chars', '--pane-id', paneId, text], sessionOverride);
    if (write.status !== 0) {
      throw new Error(`zellij write-chars failed: ${write.stderr.trim() || write.error?.message || 'unknown error'}`);
    }
    sleepSync(PROMPT_INPUT_DELAY_MS);
    const enter = this._run(['action', 'send-keys', '--pane-id', paneId, 'Enter'], sessionOverride);
    if (enter.status !== 0) {
      throw new Error(`zellij send-keys Enter failed: ${enter.stderr.trim() || enter.error?.message || 'unknown error'}`);
    }
    sleepSync(PROMPT_INPUT_DELAY_MS);
  },

  splitPane({ cwd, name, command, args = [], direction, newTab = false, noFocus = false, dryRun = false }) {
    // zellij `new-pane` has no non-focus-stealing flag (only placement/suspend
    // options), so `noFocus` cannot be honored here. Surface the degradation
    // instead of swallowing it silently, but do not fail the split.
    if (noFocus) {
      console.error('zellij does not support non-focus-stealing splits; the new pane will take focus.');
    }
    const session = this.session();
    // Guard like `_run`: a null session must produce this module's own clean
    // error rather than a raw/confusing spawnSync failure from `--session
    // undefined ...` buried in the argv.
    if (!session) {
      throw new Error('zellij session is not set (ZELLIJ_SESSION_NAME is empty); cannot target a pane.');
    }
    const base = ['--session', session, 'action'];
    if (newTab) {
      const newTabArgs = [...base, 'new-tab', '--name', name];
      const paneArgs = [...base, 'new-pane', '--name', name, '--in-place', '--cwd', cwd, '--', command, ...args];
      if (dryRun) {
        logCmd('zellij', newTabArgs);
        logCmd('zellij', paneArgs);
        return `dry-run-${name}`;
      }
      run('zellij', newTabArgs);
      const r = run('zellij', paneArgs);
      if ((r.status ?? 1) !== 0) {
        throw new Error(`zellij new-pane (tab) failed: ${r.stderr?.trim() || r.error?.message || 'unknown error'}`);
      }
      // new-pane --in-place replaces the tab's pane; it does not print a usable id.
      return null;
    }
    const paneArgs = [...base, 'new-pane', '--name', name, '--cwd', cwd];
    if (direction) paneArgs.push('--direction', direction);
    paneArgs.push('--', command, ...args);
    if (dryRun) {
      logCmd('zellij', paneArgs);
      return `dry-run-${name}`;
    }
    const r = run('zellij', paneArgs);
    if ((r.status ?? 1) !== 0) {
      throw new Error(`zellij new-pane failed: ${r.stderr?.trim() || r.error?.message || 'unknown error'}`);
    }
    const id = r.stdout.trim();
    if (!id) return null;
    return /^\d+$/.test(id) ? `terminal_${id}` : id;
  },

  spawnStandaloneSession({ cwd, prompt, dryRun = false }) {
    const launch = terminalLauncher();
    if (!launch) return 1; // no launcher -> caller falls back to manual (mode C)
    // A temp KDL layout sidesteps cross-process command quoting.
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const kdl = `layout {\n    pane cwd="${esc(cwd)}" {\n        command "claude"\n        args "${esc(prompt)}"\n    }\n}\n`;
    const layoutFile = path.join(os.tmpdir(), `handoff-go-${Date.now()}.kdl`);
    const zellijArgs = ['--layout', layoutFile];
    if (dryRun) {
      logCmd('<terminal>', ['zellij', ...zellijArgs]);
      return 0;
    }
    fs.writeFileSync(layoutFile, kdl, 'utf8');
    return launch('zellij', zellijArgs).status ?? 1;
  },
};

// ---------------------------------------------------------------------------
// herdr backend
// ---------------------------------------------------------------------------

const herdrBackend = {
  name: 'herdr',

  onPath() {
    return cliOnPath('herdr');
  },

  insideSession() {
    return process.env.HERDR_ENV === '1';
  },

  session() {
    // herdr socket commands operate on the running instance, not a named
    // session, so this value is only used as a non-null marker + roster label.
    return process.env.HERDR_WORKSPACE_ID || (process.env.HERDR_ENV === '1' ? 'herdr' : null);
  },

  currentPaneId() {
    // herdr exports HERDR_PANE_ID into each pane, fixed to the pane that
    // launched this process (like zellij's ZELLIJ_PANE_ID) -- more reliable
    // than the focused pane, which tracks live UI attention.
    if (process.env.HERDR_PANE_ID) return process.env.HERDR_PANE_ID;
    // Fallback: ask the running instance which pane is focused.
    const r = run('herdr', ['pane', 'current', '--current']);
    if (r.status !== 0) return null;
    try {
      return JSON.parse(r.stdout)?.result?.pane?.pane_id ?? null;
    } catch {
      return null;
    }
  },

  _normalizePane(p) {
    // herdr keys are snake_case (verified against a live herdr session). NOTE
    // (verified empirically): `pane list` exposes the pane's launch name under
    // `label`, whereas `agent list` / `agent start` use `name` -- so match on
    // `label` here (with `name` as a fallback). `agent` is the detected agent
    // command (e.g. "claude").
    //
    // ASSUMPTION (NOT empirically verified): herdr removes exited panes from
    // `pane list` immediately, so any listed pane is live -- hence live:true for
    // all. No better liveness signal is exposed by the herdr API as currently
    // understood. If this assumption is ever wrong, dead-pane detection in
    // deliverMessage will not catch it (it will keep targeting a dead pane).
    return {
      id: p.pane_id,
      title: p.label || p.name || '',
      command: p.agent || '',
      live: true,
    };
  },

  listPanes() {
    const r = run('herdr', ['pane', 'list']);
    if (r.status !== 0) {
      throw new Error(`herdr pane list failed: ${r.stderr.trim() || r.error?.message || 'unknown error'}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      throw new Error('Could not parse herdr pane metadata (pane list).');
    }
    const panes = parsed?.result?.panes;
    if (!Array.isArray(panes)) throw new Error('Unexpected herdr pane metadata shape.');
    return panes.filter((p) => p && typeof p === 'object').map((p) => this._normalizePane(p));
  },

  resolvePaneId(agentId, hintPaneId, _sessionOverride) {
    // herdr pane ids are opaque strings (e.g. "w1:p1"); no reshaping needed.
    // herdr addresses the running instance over its socket, so the session
    // override (relevant only to zellij) is intentionally ignored here.
    return resolvePaneIdFrom(this.listPanes(), agentId, hintPaneId || null);
  },

  sendToPane(paneId, text, _sessionOverride) {
    // session override intentionally ignored (herdr targets the socket instance).
    const write = run('herdr', ['pane', 'send-text', paneId, text]);
    if (write.status !== 0) {
      throw new Error(`herdr pane send-text failed: ${write.stderr.trim() || write.error?.message || 'unknown error'}`);
    }
    sleepSync(PROMPT_INPUT_DELAY_MS);
    const enter = run('herdr', ['pane', 'send-keys', paneId, 'Enter']);
    if (enter.status !== 0) {
      throw new Error(`herdr pane send-keys Enter failed: ${enter.stderr.trim() || enter.error?.message || 'unknown error'}`);
    }
    sleepSync(PROMPT_INPUT_DELAY_MS);
  },

  splitPane({ cwd, name, command, args = [], direction, newTab = false, noFocus = false, dryRun = false }) {
    // `herdr agent start` runs argv in a fresh split and names the pane, which
    // is the herdr analogue of `zellij new-pane --name`. (herdr `pane split`
    // only splits; it does not run a command.) newTab is not modeled for herdr
    // -- it always uses a split. Surface the degradation instead of silently
    // claiming tab mode was honored.
    if (newTab) {
      console.error('herdr does not model a distinct tab mode for this operation; using a split instead.');
    }
    const startArgs = ['agent', 'start', name, '--cwd', cwd];
    if (direction) startArgs.push('--split', direction === 'down' ? 'down' : 'right');
    if (noFocus) startArgs.push('--no-focus');
    startArgs.push('--', command, ...args);
    if (dryRun) {
      logCmd('herdr', startArgs);
      return `dry-run-${name}`;
    }
    const r = run('herdr', startArgs);
    if ((r.status ?? 1) !== 0) {
      throw new Error(`herdr agent start failed: ${r.stderr?.trim() || r.error?.message || 'unknown error'}`);
    }
    try {
      return JSON.parse(r.stdout)?.result?.agent?.pane_id ?? null;
    } catch {
      return null;
    }
  },

  spawnStandaloneSession({ cwd, prompt, dryRun = false }) {
    // Mode B for herdr: open a terminal hosting a named herdr session, then
    // inject a claude agent into it. NOTE: this path is best-effort and was NOT
    // empirically verified (this sandbox runs INSIDE herdr, i.e. mode A). The
    // socket for the fresh session may not be ready immediately, and the
    // terminal launcher can block; callers treat any non-zero return as a
    // signal to fall back to the manual command (mode C).
    const launch = terminalLauncher();
    if (!launch) return 1;
    const sessionName = `handoff-${Date.now()}`;
    const startArgs = ['agent', 'start', sessionName, '--cwd', cwd, '--', 'claude', prompt];
    if (dryRun) {
      logCmd('<terminal>', ['herdr', '--session', sessionName]);
      logCmd('herdr', startArgs);
      return 0;
    }
    const term = launch('herdr', ['--session', sessionName]);
    if ((term.status ?? 1) !== 0) return term.status ?? 1;
    sleepSync(1500); // give the fresh session's socket a moment
    return run('herdr', startArgs).status ?? 1;
  },
};

// ---------------------------------------------------------------------------
// detection + public facade
// ---------------------------------------------------------------------------

let _chosenBackend = null; // the backend selected by detect(), regardless of PATH
let _active; // 'herdr' | 'zellij' | null | undefined(=not yet detected)

function readConfigTransport(configPath) {
  try {
    const value = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.transport;
    if (value === 'herdr' || value === 'zellij') return value;
  } catch {
    // missing/invalid config -> fall through to environment-based detection
  }
  return null;
}

function chosen() {
  if (_active === undefined) transport.detect();
  return _chosenBackend;
}

export const transport = {
  // Decide which multiplexer to drive. Precedence:
  //   1. explicit transport.config.json ({ "transport": "herdr" | "zellij" })
  //   2. HERDR_ENV === '1'                       -> herdr
  //   3. ZELLIJ / ZELLIJ_SESSION_NAME set        -> zellij
  //   4. default                                 -> herdr (preferred)
  // Returns the chosen name, or null if the selected CLI is not on PATH.
  detect(configPath = DEFAULT_CONFIG_PATH) {
    let choice = readConfigTransport(configPath);
    if (!choice && process.env.HERDR_ENV === '1') choice = 'herdr';
    if (!choice && (process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME)) choice = 'zellij';
    if (!choice) choice = 'herdr';
    _chosenBackend = choice === 'zellij' ? zellijBackend : herdrBackend;
    _active = _chosenBackend.onPath() ? choice : null;
    return _active;
  },

  // The chosen transport name if its CLI is on PATH, else null.
  active() {
    if (_active === undefined) transport.detect();
    return _active;
  },

  // Force the active backend to a known name, bypassing config-file/env
  // detection entirely. Used when a fresh process already knows which
  // backend was chosen at launch time (persisted in a roster written by that
  // launch) and must not re-detect via some *other* skill's
  // transport.config.json (e.g. bus.mjs living in launch-team/ delivering a
  // reply for a sidekick-go team must honor sidekick-go's own choice).
  selectBackend(name) {
    const backend = name === 'zellij' ? zellijBackend : name === 'herdr' ? herdrBackend : null;
    if (!backend) throw new Error(`Unknown transport backend "${name}".`);
    _chosenBackend = backend;
    _active = backend.onPath() ? name : null;
    return _active;
  },

  onPath() { return chosen().onPath(); },
  insideSession() { return chosen().insideSession(); },
  session() { return chosen().session(); },
  currentPaneId() { return chosen().currentPaneId(); },
  listPanes() { return chosen().listPanes(); },
  resolvePaneId(agentId, hint, sessionOverride) { return chosen().resolvePaneId(agentId, hint, sessionOverride); },
  sendToPane(paneId, text, sessionOverride) { return chosen().sendToPane(paneId, text, sessionOverride); },
  splitPane(opts) { return chosen().splitPane(opts); },
  spawnStandaloneSession(opts) { return chosen().spawnStandaloneSession(opts); },
  hasTerminalLauncher() { return terminalLauncher() !== null; },
};
