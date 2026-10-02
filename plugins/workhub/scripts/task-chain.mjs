#!/usr/bin/env node
// task-chain — bookkeeping for the task-chain skill (an ordered run of tasks).
//
// The orchestrating agent does the work; this script keeps the state that must
// survive it: which tasks are in the chain, whose `depends_on` was detached and
// has to be restored, and how each task ended. State lives in
// `<vault>/_ai/state/task-chain.json`.
//
// Usage:
//   node task-chain.mjs preflight T-0001 T-0002 ...
//   node task-chain.mjs init      T-0001 T-0002 ... [--max 5] [--merge]
//                                 [--detach T-0002] [--delegate T-0003]
//   node task-chain.mjs next
//   node task-chain.mjs mark      <id> review|failed|stopped [--note "..."]
//   node task-chain.mjs finish
//   node task-chain.mjs status
//   (all commands accept --vault <path>)
//
// Vault resolution matches task-cli: --vault, WORKHUB_VAULT, the current
// directory, then the app config.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TASK_CLI = fileURLToPath(new URL("./task-cli.mjs", import.meta.url));
const DEFAULT_MAX = 5;

function fail(msg) {
  console.error(`task-chain: ${msg}`);
  process.exit(1);
}

function isVault(dir) {
  try {
    return (
      fs.statSync(path.join(dir, "tasks")).isDirectory() &&
      fs.statSync(path.join(dir, "_ai")).isDirectory()
    );
  } catch {
    return false;
  }
}

function resolveVault(flags) {
  if (flags.vault) {
    if (!isVault(flags.vault)) fail(`--vault path is not a workhub vault: ${flags.vault}`);
    return flags.vault;
  }
  const env = process.env.WORKHUB_VAULT;
  if (env && isVault(env)) return env;
  if (isVault(process.cwd())) return process.cwd();
  const cfgPath =
    process.platform === "win32" && process.env.APPDATA
      ? path.join(process.env.APPDATA, "workhub", "config.json")
      : path.join(process.env.HOME ?? "", ".config", "workhub", "config.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    const p = cfg?.settings?.vault_path ?? cfg?.vault_path;
    if (p && isVault(p)) return p;
  } catch {
    /* fall through */
  }
  fail("could not resolve a vault: pass --vault <path> or run from inside one");
}

// ---------------------------------------------------------------------
// tasks, read through task-cli so the frontmatter rules stay in one place
// ---------------------------------------------------------------------

function cli(vault, args) {
  return execFileSync(process.execPath, [TASK_CLI, ...args, "--vault", vault], {
    encoding: "utf-8",
  });
}

function extraValue(task, key) {
  const line = (task.extra ?? []).find((l) => new RegExp(`^${key}\\s*:`).test(l.trimStart()));
  return line ? line.slice(line.indexOf(":") + 1).trim() : undefined;
}

function depsOf(task) {
  const lines = task.extra ?? [];
  const at = lines.findIndex((l) => /^depends_on\s*:/.test(l.trimStart()));
  if (at < 0) return [];
  const val = lines[at].slice(lines[at].indexOf(":") + 1).trim();
  const unq = (s) => s.trim().replace(/^["']|["']$/g, "");
  if (val.startsWith("[") && val.endsWith("]")) {
    return val
      .slice(1, -1)
      .split(",")
      .map(unq)
      .filter(Boolean);
  }
  if (val !== "") return [unq(val)];
  const out = [];
  for (const l of lines.slice(at + 1)) {
    const t = l.trimStart();
    if (!t.startsWith("- ")) break;
    out.push(unq(t.slice(2)));
  }
  return out;
}

function loadTasks(vault) {
  return JSON.parse(cli(vault, ["list", "--json"]));
}

// ---------------------------------------------------------------------
// state
// ---------------------------------------------------------------------

function statePath(vault) {
  return path.join(vault, "_ai", "state", "task-chain.json");
}

function readState(vault) {
  try {
    return JSON.parse(fs.readFileSync(statePath(vault), "utf-8"));
  } catch {
    return null;
  }
}

function writeState(vault, state) {
  fs.mkdirSync(path.dirname(statePath(vault)), { recursive: true });
  fs.writeFileSync(statePath(vault), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function activeState(vault) {
  const state = readState(vault);
  if (!state || state.finished) fail("no active chain (run init first)");
  return state;
}

// ---------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------

function inspect(chain, all) {
  return chain.map((id, index) => {
    const task = all.find((t) => t.id === id);
    if (!task) return { id, problems: ["no such task"] };
    const problems = [];
    if (!["todo", "doing"].includes(task.status)) {
      problems.push(`status is ${task.status}; task-start only takes todo or doing`);
    }
    if (extraValue(task, "blocked") === "true") problems.push("blocked");
    const deps = depsOf(task).map((d) => {
      const dep = all.find((t) => t.id === d);
      const position = chain.indexOf(d);
      const open = dep && dep.status !== "done";
      let where = "done";
      if (open) where = position < 0 ? "outside" : position < index ? "earlier" : "later";
      return { id: d, status: dep?.status ?? "missing", where };
    });
    for (const d of deps) {
      if (d.where === "outside") problems.push(`open predecessor outside the chain: ${d.id} [${d.status}]`);
      if (d.where === "later") problems.push(`predecessor ${d.id} comes later in the chain`);
    }
    return {
      id,
      title: task.title,
      status: task.status,
      confirm: extraValue(task, "confirm") === "true",
      deps,
      problems,
    };
  });
}

function cmdPreflight(vault, chain) {
  if (chain.length === 0) fail("usage: task-chain preflight <id> <id> ...");
  console.log(JSON.stringify({ tasks: inspect(chain, loadTasks(vault)) }, null, 2));
}

function listFlag(value) {
  return value ? String(value).split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function cmdInit(vault, chain, flags) {
  const existing = readState(vault);
  if (existing && !existing.finished) {
    fail("a chain is already active; finish it first (`task-chain finish` restores depends_on)");
  }
  if (chain.length === 0) fail("usage: task-chain init <id> <id> ...");
  const max = flags.max ? Number(flags.max) : DEFAULT_MAX;
  if (!Number.isInteger(max) || max < 1) fail("--max must be a positive integer");
  if (chain.length > max) fail(`${chain.length} tasks exceed the limit of ${max}; shorten the chain or raise --max`);

  const all = loadTasks(vault);
  const detach = listFlag(flags.detach);
  const delegate = listFlag(flags.delegate);
  for (const id of [...detach, ...delegate]) {
    if (!chain.includes(id)) fail(`${id} is not in the chain`);
  }
  const report = inspect(chain, all);
  for (const t of report) {
    if (t.problems.length) fail(`${t.id}: ${t.problems.join("; ")}`);
  }
  // A predecessor still open and in the chain blocks start unless detached.
  for (const t of report) {
    const waits = t.deps.filter((d) => d.where === "earlier");
    if (waits.length && !detach.includes(t.id)) {
      fail(`${t.id} waits on ${waits.map((d) => d.id).join(", ")}; add it to --detach or leave it out of the chain`);
    }
  }

  const detached = {};
  for (const id of detach) {
    const task = all.find((t) => t.id === id);
    const original = depsOf(task);
    const inChain = new Set(chain.slice(0, chain.indexOf(id)));
    const kept = original.filter((d) => !inChain.has(d));
    detached[id] = original;
    cli(vault, ["update", id, "--depends-on", kept.join(",")]);
  }

  writeState(vault, {
    version: 1,
    started: new Date().toISOString(),
    chain,
    max,
    merge: Boolean(flags.merge),
    confirm: Object.fromEntries(
      report.filter((t) => t.confirm).map((t) => [t.id, delegate.includes(t.id) ? "delegate" : "relay"]),
    ),
    detached,
    items: Object.fromEntries(chain.map((id) => [id, { state: "pending" }])),
    finished: false,
  });
  console.log(`chain of ${chain.length} initialised: ${chain.join(" -> ")}`);
}

function cmdNext(vault) {
  const state = activeState(vault);
  const failed = Object.entries(state.items).find(([, v]) => v.state === "failed" || v.state === "stopped");
  if (failed) {
    console.log(JSON.stringify({ next: null, halted: failed[0], reason: failed[1].note ?? failed[1].state }));
    return;
  }
  const id = state.chain.find((c) => state.items[c].state === "pending");
  if (!id) {
    console.log(JSON.stringify({ next: null, halted: null, reason: "all tasks reached review" }));
    return;
  }
  console.log(
    JSON.stringify({
      next: id,
      confirm: state.confirm[id] ?? null,
      merge: state.merge,
      remaining: state.chain.filter((c) => state.items[c].state === "pending").length,
    }),
  );
}

function cmdMark(vault, id, outcome, flags) {
  const state = activeState(vault);
  if (!state.items[id]) fail(`${id} is not in the chain`);
  if (!["review", "failed", "stopped"].includes(outcome)) {
    fail("usage: task-chain mark <id> review|failed|stopped [--note ...]");
  }
  if (outcome === "review") {
    // The task file decides, never the child's own account of itself.
    const task = loadTasks(vault).find((t) => t.id === id);
    if (task?.status !== "review") {
      fail(`${id} has status ${task?.status}, not review; mark it failed or stopped instead`);
    }
  }
  state.items[id] = { state: outcome, ...(flags.note ? { note: flags.note } : {}) };
  writeState(vault, state);
  console.log(`${id}: ${outcome}`);
}

function cmdFinish(vault) {
  const state = activeState(vault);
  for (const [id, original] of Object.entries(state.detached)) {
    cli(vault, ["update", id, "--depends-on", original.join(",")]);
  }
  state.finished = true;
  state.finished_at = new Date().toISOString();
  writeState(vault, state);
  const lines = state.chain.map((id) => `${id}: ${state.items[id].state}${state.items[id].note ? ` (${state.items[id].note})` : ""}`);
  console.log(`${lines.join("\n")}\nrestored depends_on for: ${Object.keys(state.detached).join(", ") || "none"}`);
}

function cmdStatus(vault) {
  const state = readState(vault);
  console.log(state ? JSON.stringify(state, null, 2) : "no chain state");
}

// ---------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(["merge"]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && BOOLEAN_FLAGS.has(a.slice(2))) {
      flags[a.slice(2)] = true;
    } else if (a.startsWith("--")) {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) fail(`missing value for ${a}`);
      flags[a.slice(2)] = val;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, ...rest] = positional;
const vault = resolveVault(flags);

switch (command) {
  case "preflight":
    cmdPreflight(vault, rest);
    break;
  case "init":
    cmdInit(vault, rest, flags);
    break;
  case "next":
    cmdNext(vault);
    break;
  case "mark":
    cmdMark(vault, rest[0], rest[1], flags);
    break;
  case "finish":
    cmdFinish(vault);
    break;
  case "status":
    cmdStatus(vault);
    break;
  default:
    fail("usage: task-chain <preflight|init|next|mark|finish|status> [args] (see file header)");
}
