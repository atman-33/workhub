#!/usr/bin/env node
// comms-cli — the agent's side of the owner's inbox (`<vault>/_ai/comms/`).
//
// When the secretary escalates, the agent files a question here instead of
// blocking on the terminal; the owner answers it in the workhub app or in
// Obsidian, and the next session picks the answer up. Reports (no answer
// needed) go through the same folder.
//
// Usage:
//   node comms-cli.mjs ask    --question "..." [--context "..."] [--option "A: ..."]
//                             [--task T-0042] [--title "..."] [--json]
//   node comms-cli.mjs report --title "..." [--context "..."] [--task T-0042] [--json]
//   node comms-cli.mjs list   [--status pending|answered|all] [--task T-0042] [--json]
//   node comms-cli.mjs answer <id> --answer "..."
//   (all commands accept --vault <path>)
//
// Vault resolution order: --vault flag, WORKHUB_VAULT env var, the current
// directory if it looks like a vault (has tasks/ and _ai/), then the workhub
// app config (`~/.workhub/config.json`, falling back to the pre-0.49
// `%APPDATA%\workhub\config.json`).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------
// vault resolution
// ---------------------------------------------------------------------

function fail(msg) {
  console.error(`comms-cli: ${msg}`);
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

function readAppConfig() {
  for (const dir of [
    path.join(os.homedir(), ".workhub"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "workhub") : null,
  ]) {
    if (!dir) continue;
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf-8"));
    } catch {
      // try the next location
    }
  }
  return {};
}

function resolveVault(flags) {
  if (flags.vault) {
    if (!isVault(flags.vault)) fail(`--vault path is not a workhub vault: ${flags.vault}`);
    return flags.vault;
  }
  const env = process.env.WORKHUB_VAULT;
  if (env && isVault(env)) return env;
  if (isVault(process.cwd())) return process.cwd();
  const cfg = readAppConfig();
  const p = cfg?.settings?.vault_path ?? cfg?.vault_path;
  if (p && isVault(p)) return p;
  fail(
    "could not resolve a vault: pass --vault <path>, set WORKHUB_VAULT, run from inside a vault, or configure the workhub app",
  );
}

// ---------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------

/** Parse `--flag value` pairs; `--option` may repeat. */
function parseArgs(argv) {
  const flags = {};
  const options = [];
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    i += 1;
    if (key === "option") options.push(value);
    else flags[key] = value;
  }
  return { flags, options, positional };
}

// ---------------------------------------------------------------------
// message files
// ---------------------------------------------------------------------

const COMMS_DIR = ["_ai", "comms"];

function commsDir(vault) {
  return path.join(vault, ...COMMS_DIR);
}

function listFiles(vault) {
  const dir = commsDir(vault);
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".md") && /^[QR]-\d{4}-/.test(n))
      .sort();
  } catch {
    return [];
  }
}

/** Next free number across questions and reports, so ids never collide. */
function nextId(vault, prefix) {
  let max = 0;
  for (const name of listFiles(vault)) {
    const m = /^[QR]-(\d{4})-/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function slugify(text) {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "message";
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${today()}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseMessage(file) {
  const content = fs.readFileSync(file, "utf-8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const front = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      front[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { front, content };
}

function findById(vault, id) {
  const name = listFiles(vault).find((n) => n.startsWith(`${id}-`));
  if (!name) fail(`no message with id ${id}`);
  return path.join(commsDir(vault), name);
}

// ---------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------

function cmdAsk(vault, flags, options) {
  const question = typeof flags.question === "string" ? flags.question : "";
  if (!question) fail("ask requires --question");
  const id = nextId(vault, "Q");
  const title = typeof flags.title === "string" ? flags.title : question;
  const file = path.join(commsDir(vault), `${id}-${slugify(title)}.md`);

  const lines = [
    "---",
    `id: ${id}`,
    "type: question",
    `task: ${typeof flags.task === "string" ? flags.task : ""}`,
    "status: pending",
    `created: ${nowIso()}`,
    "answered: ",
    "---",
    "",
    "## Question",
    "",
    question,
    "",
    "## Context",
    "",
    typeof flags.context === "string" && flags.context ? flags.context : "(none given)",
    "",
  ];
  if (options.length > 0) {
    lines.push("## Options", "");
    for (const option of options) lines.push(`- ${option}`);
    lines.push("");
  }
  lines.push("## Answer", "", "");

  fs.mkdirSync(commsDir(vault), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
  return { id, file, status: "pending" };
}

function cmdReport(vault, flags) {
  const title = typeof flags.title === "string" ? flags.title : "";
  if (!title) fail("report requires --title");
  const id = nextId(vault, "R");
  const file = path.join(commsDir(vault), `${id}-${slugify(title)}.md`);

  const body = [
    "---",
    `id: ${id}`,
    "type: report",
    `task: ${typeof flags.task === "string" ? flags.task : ""}`,
    "status: pending",
    `created: ${nowIso()}`,
    "answered: ",
    "---",
    "",
    `## ${title}`,
    "",
    typeof flags.context === "string" && flags.context ? flags.context : "(no detail given)",
    "",
  ].join("\n");

  fs.mkdirSync(commsDir(vault), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
  return { id, file, status: "pending" };
}

function cmdList(vault, flags) {
  const want = typeof flags.status === "string" ? flags.status : "pending";
  const task = typeof flags.task === "string" ? flags.task : "";
  const items = [];
  for (const name of listFiles(vault)) {
    const file = path.join(commsDir(vault), name);
    const { front } = parseMessage(file);
    if (want !== "all" && (front.status ?? "pending") !== want) continue;
    if (task && front.task !== task) continue;
    items.push({
      id: front.id ?? name,
      type: front.type ?? "question",
      task: front.task ?? "",
      status: front.status ?? "pending",
      created: front.created ?? "",
      file,
    });
  }
  return items;
}

function cmdAnswer(vault, id, flags) {
  const answer = typeof flags.answer === "string" ? flags.answer : "";
  if (!answer) fail("answer requires --answer");
  const file = findById(vault, id);
  const { content } = parseMessage(file);

  // Replacements go through functions so `$&` and friends in the answer text
  // are inserted literally rather than expanded.
  let updated = content
    .replace(/^status: .*$/m, () => "status: answered")
    .replace(/^answered: ?.*$/m, () => `answered: ${nowIso()}`);
  updated = /^## Answer$/m.test(updated)
    ? updated.replace(/^## Answer$/m, () => `## Answer\n\n${answer}`).replace(/\n{3,}$/, "\n")
    : `${updated.replace(/\s*$/, "")}\n\n## Answer\n\n${answer}\n`;

  fs.writeFileSync(file, updated, "utf-8");
  return { id, file, status: "answered" };
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

const { flags, options, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];
if (!command) fail("usage: comms-cli.mjs <ask|report|list|answer> [...]");

const vault = resolveVault(flags);

if (command === "ask" || command === "report") {
  const result = command === "ask" ? cmdAsk(vault, flags, options) : cmdReport(vault, flags);
  if (flags.json) console.log(JSON.stringify(result));
  else {
    console.log(`filed ${result.id} (status: pending) — ${result.file.replaceAll("\\", "/")}`);
    if (command === "ask") {
      console.log(
        "the owner answers it in the workhub app; mark the task blocked and continue with what does not depend on it",
      );
    }
  }
} else if (command === "list") {
  const items = cmdList(vault, flags);
  if (flags.json) console.log(JSON.stringify(items));
  else if (items.length === 0) console.log("no messages");
  else {
    for (const item of items) {
      const task = item.task ? ` ${item.task}` : "";
      console.log(`${item.id} [${item.status}]${task} ${item.created} — ${item.file.replaceAll("\\", "/")}`);
    }
  }
} else if (command === "answer") {
  const id = positional[1];
  if (!id) fail("answer requires an id, e.g. `answer Q-0001 --answer \"...\"`");
  const result = cmdAnswer(vault, id, flags);
  if (flags.json) console.log(JSON.stringify(result));
  else console.log(`answered ${result.id} — ${result.file.replaceAll("\\", "/")}`);
} else {
  fail(`unknown command: ${command}`);
}
