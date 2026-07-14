#!/usr/bin/env node
// task-cli — safe task-board operations for the workhub vault.
//
// Used by the task-list / task-start / task-report skills so agents don't
// hand-edit frontmatter (typo-prone) or leave `_ai/index/tasks.json` stale.
// Mirrors the parse/render rules of the app's src-tauri/src/tasks.rs: the
// body after the closing `---` is preserved byte-for-byte, and `model` /
// `order` / `archived` lines are emitted only when set.
//
// Usage:
//   node task-cli.mjs list   [--status s] [--assignee a] [--project p] [--json]
//   node task-cli.mjs start  <id>
//   node task-cli.mjs update <id> [--status s] [--assignee a] [--project p]
//                                 [--priority p] [--model m] [--due d]
//   node task-cli.mjs report <id>
//   (all commands accept --vault <path>)
//
// Vault resolution order: --vault flag, WORKHUB_VAULT env var, the current
// directory if it looks like a vault (has tasks/ and _ai/), then
// %APPDATA%/workhub/config.json (settings.vault_path).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------
// vault resolution
// ---------------------------------------------------------------------

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

function configPath() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "workhub", "config.json");
  }
  const home = process.env.HOME ?? "";
  return path.join(home, ".config", "workhub", "config.json");
}

function resolveVault(flags) {
  if (flags.vault) {
    if (!isVault(flags.vault)) fail(`--vault path is not a workhub vault: ${flags.vault}`);
    return flags.vault;
  }
  const env = process.env.WORKHUB_VAULT;
  if (env && isVault(env)) return env;
  if (isVault(process.cwd())) return process.cwd();
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    const p = cfg?.settings?.vault_path ?? cfg?.vault_path;
    if (p && isVault(p)) return p;
  } catch {
    /* fall through */
  }
  fail(
    "could not resolve a vault: pass --vault <path>, set WORKHUB_VAULT, run from inside a vault, or configure the workhub app",
  );
}

// ---------------------------------------------------------------------
// frontmatter parse / render (mirrors src-tauri/src/tasks.rs)
// ---------------------------------------------------------------------

function splitFrontmatter(content) {
  const lines = content.split(/(?<=\n)/);
  if ((lines[0] ?? "").replace(/[\r\n]+$/, "") !== "---") {
    throw new Error("file does not start with a frontmatter block");
  }
  let consumed = lines[0].length;
  let front = "";
  let closed = false;
  for (const line of lines.slice(1)) {
    consumed += line.length;
    if (line.replace(/[\r\n]+$/, "") === "---") {
      closed = true;
      break;
    }
    front += line;
  }
  if (!closed) throw new Error("frontmatter block is not closed");
  return { front, body: content.slice(consumed) };
}

function unquote(s) {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseFrontmatter(front) {
  const map = {};
  let tags = [];
  let inTagsBlock = false;
  for (const rawLine of front.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (inTagsBlock) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("- ")) {
        tags.push(unquote(trimmed.slice(2)));
        continue;
      } else if (trimmed === "") {
        continue;
      }
      inTagsBlock = false;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === "tags") {
      if (val === "") {
        inTagsBlock = true;
        tags = [];
      } else if (val.startsWith("[") && val.endsWith("]")) {
        tags = val
          .slice(1, -1)
          .split(",")
          .map((s) => unquote(s))
          .filter(Boolean);
      } else {
        tags = [unquote(val)];
      }
    } else {
      map[key] = unquote(val);
    }
  }
  return { map, tags };
}

function yamlScalar(s) {
  const needsQuote =
    s === "" ||
    s.includes(":") ||
    s.includes("#") ||
    s.includes("[") ||
    s.includes("]") ||
    s.includes(",") ||
    s !== s.trim();
  return needsQuote ? `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : s;
}

function renderTags(tags) {
  return tags.length === 0 ? "[]" : `[${tags.map(yamlScalar).join(", ")}]`;
}

function renderFrontmatter(t) {
  const modelLine = t.model ? `model: ${yamlScalar(t.model)}\n` : "";
  // JS String(3) is "3" (never "3.0"), matching the Rust render_order rule.
  const orderLine = t.order !== null && t.order !== undefined ? `order: ${String(t.order)}\n` : "";
  const archivedLine = t.archived ? "archived: true\n" : "";
  return (
    `---\n` +
    `id: ${t.id}\n` +
    `title: ${yamlScalar(t.title)}\n` +
    `status: ${t.status}\n` +
    `assignee: ${t.assignee}\n` +
    `project: ${yamlScalar(t.project)}\n` +
    `priority: ${t.priority}\n` +
    modelLine +
    orderLine +
    `due: ${t.due}\n` +
    `tags: ${renderTags(t.tags)}\n` +
    archivedLine +
    `created: ${t.created}\n` +
    `updated: ${t.updated}\n` +
    `---\n`
  );
}

function parseTaskFile(file) {
  const content = fs.readFileSync(file, "utf-8");
  const { front, body } = splitFrontmatter(content);
  const { map, tags } = parseFrontmatter(front);
  const get = (k, dflt = "") => map[k] ?? dflt;
  const orderRaw = map.order !== undefined ? Number(map.order) : NaN;
  return {
    id: get("id"),
    title: get("title"),
    status: get("status") || "inbox",
    assignee: get("assignee") || "me",
    project: get("project"),
    priority: get("priority") || "medium",
    model: get("model"),
    order: Number.isFinite(orderRaw) ? orderRaw : null,
    due: get("due"),
    tags,
    archived: map.archived === "true",
    created: get("created"),
    updated: get("updated"),
    file: file.replaceAll("\\", "/"),
    body,
  };
}

function writeTaskFile(task) {
  fs.writeFileSync(task.file, renderFrontmatter(task) + task.body, "utf-8");
}

// ---------------------------------------------------------------------
// scan / index
// ---------------------------------------------------------------------

function scanTasks(vault) {
  const out = [];
  // Active tasks live in tasks/, archived ones in tasks/archive/. Scanning
  // both keeps archived tasks in the index and reserves their ids. Reading
  // tasks/ non-recursively skips the archive/ subdir (no .md extension), so
  // the two passes never double-count. Mirrors src-tauri/src/tasks.rs.
  scanDirInto(path.join(vault, "tasks"), out);
  scanDirInto(path.join(vault, "tasks", "archive"), out);
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function scanDirInto(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md") || name === "_index.md") continue;
    try {
      out.push(parseTaskFile(path.join(dir, name)));
    } catch {
      /* skip unparsable files, like the app does */
    }
  }
}

function regenerateIndex(vault) {
  const tasks = scanTasks(vault);
  const vaultPrefix = path.resolve(vault).replaceAll("\\", "/");
  const entries = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    project: t.project,
    priority: t.priority,
    model: t.model,
    order: t.order,
    due: t.due,
    tags: t.tags,
    archived: t.archived,
    created: t.created,
    updated: t.updated,
    file: t.file.startsWith(vaultPrefix)
      ? t.file.slice(vaultPrefix.length).replace(/^\//, "")
      : t.file,
  }));
  const indexFile = path.join(vault, "_ai", "index", "tasks.json");
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify(entries, null, 2), "utf-8");
}

function findTask(vault, id) {
  const prefix = `${id} `;
  // An archived task lives under tasks/archive/, so search both directories.
  for (const dir of [path.join(vault, "tasks"), path.join(vault, "tasks", "archive")]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(prefix) && name.endsWith(".md")) {
        return parseTaskFile(path.join(dir, name));
      }
    }
  }
  fail(`task ${id} not found in ${path.join(vault, "tasks")}`);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function activeTaskFile(vault) {
  return path.join(vault, "_ai", "memory", "active-task.json");
}

// ---------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------

function cmdList(vault, flags) {
  let tasks = scanTasks(vault).filter((t) => !t.archived);
  if (flags.status) tasks = tasks.filter((t) => t.status === flags.status);
  if (flags.assignee) tasks = tasks.filter((t) => t.assignee === flags.assignee);
  if (flags.project) tasks = tasks.filter((t) => t.project === flags.project);
  regenerateIndex(vault);
  if (flags.json) {
    console.log(JSON.stringify(tasks.map(({ body: _body, ...rest }) => rest), null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log("no matching tasks");
    return;
  }
  const rows = tasks.map((t) => [t.id, t.status, t.assignee, t.priority, t.project, t.due, t.title]);
  const header = ["id", "status", "assignee", "priority", "project", "due", "title"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  for (const r of rows) console.log(fmt(r));
}

function applyUpdates(task, flags) {
  const editable = ["status", "assignee", "project", "priority", "model", "due"];
  let changed = false;
  for (const key of editable) {
    if (flags[key] !== undefined) {
      task[key] = flags[key];
      changed = true;
    }
  }
  return changed;
}

function cmdStart(vault, id) {
  const task = findTask(vault, id);
  if (task.status === "review" || task.status === "done") {
    fail(`task ${id} is '${task.status}' — only inbox/todo/doing tasks can be started`);
  }
  task.status = "doing";
  task.updated = today();
  writeTaskFile(task);
  const marker = activeTaskFile(vault);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  const relFile = path.relative(vault, task.file).replaceAll("\\", "/");
  fs.writeFileSync(
    marker,
    JSON.stringify({ id: task.id, file: relFile, started: new Date().toISOString() }, null, 2) + "\n",
    "utf-8",
  );
  regenerateIndex(vault);
  console.log(`started ${task.id} (status: doing) — ${task.file}`);
}

function cmdUpdate(vault, id, flags) {
  const task = findTask(vault, id);
  if (!applyUpdates(task, flags)) {
    fail("nothing to update — pass at least one of --status/--assignee/--project/--priority/--model/--due");
  }
  task.updated = today();
  writeTaskFile(task);
  regenerateIndex(vault);
  console.log(`updated ${task.id} — ${task.file}`);
}

function cmdReport(vault, id) {
  const task = findTask(vault, id);
  task.status = "review";
  task.updated = today();
  writeTaskFile(task);
  const marker = activeTaskFile(vault);
  try {
    const active = JSON.parse(fs.readFileSync(marker, "utf-8"));
    if (active?.id === id) fs.unlinkSync(marker);
  } catch {
    /* no marker or unreadable — nothing to clear */
  }
  regenerateIndex(vault);
  console.log(`reported ${task.id} (status: review) — remember to fill its ## Results section`);
}

// ---------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------

function fail(msg) {
  console.error(`task-cli: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      flags.json = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) fail(`missing value for --${key}`);
      flags[key] = val;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, id] = positional;

switch (command) {
  case "list": {
    cmdList(resolveVault(flags), flags);
    break;
  }
  case "start": {
    if (!id) fail("usage: task-cli start <id>");
    cmdStart(resolveVault(flags), id);
    break;
  }
  case "update": {
    if (!id) fail("usage: task-cli update <id> [--status s] [...]");
    cmdUpdate(resolveVault(flags), id, flags);
    break;
  }
  case "report": {
    if (!id) fail("usage: task-cli report <id>");
    cmdReport(resolveVault(flags), id);
    break;
  }
  default:
    fail("usage: task-cli <list|start|update|report> [args] (see file header for details)");
}
