#!/usr/bin/env node
// @ts-check
/**
 * team-comms CLI - file-based asynchronous discussion over a shared folder.
 *
 *   node comms.mjs init    --root <path> --agent-id <id> [--person <name>]
 *                          [--display <name>] [--agent <tool>]
 *   node comms.mjs open    --title "<title>" --summary "<one-liner>"
 *                          [--body-file <path>] [--mention <agent>]... [--slug <slug>]
 *   node comms.mjs post    --thread <id> [--kind reply] --summary "<one-liner>"
 *                          [--body-file <path>] [--attach <path>]...
 *                          [--mention <agent>]... [--in-reply-to <post-id>]
 *                          [--state open|discussing|decided|closed] [--human]
 *   node comms.mjs scan    [--full] [--json]
 *   node comms.mjs list    [--all] [--json]
 *   node comms.mjs read    <thread-id> [--full] [--unread] [--no-mark] [--json]
 *   node comms.mjs catchup [<thread-id>] [--full] [--all] [--json]
 *   node comms.mjs digest  [<thread-id>] --file <path> | --show
 *   node comms.mjs index   [--out <path>]
 *   node comms.mjs search  <text> [--json]
 *   node comms.mjs focus   <thread-id>
 *   node comms.mjs unfocus
 *
 * Every command is safe to run when the shared folder is unavailable: it says
 * so and exits non-zero, rather than throwing a stack trace at the user.
 *
 * Design document: ../docs/design.html
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  AGENT_ID_RE,
  KINDS,
  STATE_DIR,
  STATES,
  THREAD_ID_RE,
  collectOddities,
  composeMention,
  composePost,
  ensureDir,
  findThreadDir,
  getFocus,
  isDir,
  loadConfig,
  loadDigest,
  loadState,
  markRead,
  mentionsDir,
  postsSinceDigest,
  publishAttachment,
  publishFile,
  readThread,
  removeQuietly,
  renderIndexHtml,
  resolveProjectRoot,
  rnd4,
  saveDigest,
  saveState,
  scanThreads,
  setFocus,
  slugify,
  threadsRoot,
  unreadMentions,
  unreadPosts,
  updateCache,
  utcStamp,
} from "./lib/comms-core.mjs";

// ---------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    // Repeatable flags collect into an array.
    if (key in flags) {
      flags[key] = Array.isArray(flags[key]) ? [...flags[key], next] : [flags[key], next];
    } else {
      flags[key] = next;
    }
    i += 1;
  }
  return { flags, positional };
}

/** @param {any} value */
function asList(value) {
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

/** @param {string} message */
function fail(message) {
  console.error(`team-comms: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// shared setup for every command except init
// ---------------------------------------------------------------------

function requireConfig(flags) {
  const projectRoot = typeof flags["project-root"] === "string"
    ? flags["project-root"]
    : resolveProjectRoot();
  const config = loadConfig(projectRoot);
  if (!config) {
    fail(
      `no usable .claude/team-comms.json under ${projectRoot} — run "comms init" first.`,
    );
  }
  return /** @type {NonNullable<ReturnType<typeof loadConfig>>} */ (config);
}

/** The shared folder may simply be offline; say which, and stop. */
function requireRoot(config) {
  if (!isDir(config.commsRoot)) {
    fail(
      `the comms space is not reachable at ${config.commsRoot} — ` +
        `check that the shared drive is mounted and available offline.`,
    );
  }
}

// ---------------------------------------------------------------------
// init
// ---------------------------------------------------------------------

const SPACE_README = `# Claude team comms space

This folder is an asynchronous discussion space shared by a team's coding
agents. It is written by the \`team-comms\` plugin, and by people editing
Markdown directly.

Three rules make it work. All of them matter more than they look:

1. **Never edit or delete a file that is already here.** Every post is
   immutable. Correct something by adding a new post.
2. **Only create files whose names contain your own agent id.** That is what
   makes it impossible for two machines to write the same path, which is what
   keeps a cloud-synced folder free of conflict copies.
3. **A post needs a \`## Summary\` heading** with a one- or two-line summary
   right after it — it is the only part everyone reads before deciding
   whether the post concerns them. Put anything longer under a \`## Body\`
   heading, or attach it as a file instead. (A post written by an earlier
   version of this plugin may say \`## 要旨\` instead — both spellings are
   read the same way; it is not a typo to fix.)

Layout:

- \`threads/<YYYY-MM>/<thread-id>/\` — one folder per discussion, one file per post
- \`mentions/<agent-id>/\` — pointers for "please look at this", nothing else
- \`archive/\` — finished threads, moved here rather than deleted
- \`_meta/\` — space settings and agent self-introductions
- \`_quarantine/\` — where a human moves sync conflict copies after checking them
`;

function cmdInit(flags) {
  const projectRoot = typeof flags["project-root"] === "string"
    ? flags["project-root"]
    : resolveProjectRoot();
  const existing = loadConfig(projectRoot);

  const commsRoot = typeof flags.root === "string"
    ? resolve(flags.root)
    : existing?.commsRoot;
  const agentId = typeof flags["agent-id"] === "string"
    ? flags["agent-id"].trim().toLowerCase()
    : existing?.agentId;

  if (!commsRoot) fail("--root <path to the shared comms folder> is required.");
  if (!agentId) fail("--agent-id <id> is required (lowercase, e.g. atman-desktop).");
  if (!AGENT_ID_RE.test(String(agentId))) {
    fail(
      `agent id "${agentId}" is not usable — lowercase letters, digits and ` +
        `hyphens only. Use <person>-<machine>, e.g. atman-desktop.`,
    );
  }
  if (!isDir(String(commsRoot))) {
    fail(`${commsRoot} is not a reachable directory — create or mount it first.`);
  }

  const config = {
    commsRoot: String(commsRoot),
    agentId: String(agentId),
    person: typeof flags.person === "string" ? flags.person : existing?.person ?? String(agentId).split("-")[0],
    displayName: typeof flags.display === "string" ? flags.display : existing?.displayName ?? String(agentId),
    agent: typeof flags.agent === "string" ? flags.agent : existing?.agent ?? "claude-code",
  };

  // Skeleton: create-if-missing only, never overwrite what a teammate wrote.
  ensureDir(join(config.commsRoot, "threads"));
  ensureDir(join(config.commsRoot, "mentions", config.agentId));
  ensureDir(join(config.commsRoot, "_meta", "agents"));
  ensureDir(join(config.commsRoot, "archive"));
  ensureDir(join(config.commsRoot, "_quarantine"));
  const readmePath = join(config.commsRoot, "README.md");
  if (!existsSync(readmePath)) writeFileSync(readmePath, SPACE_README, "utf8");
  const spacePath = join(config.commsRoot, "_meta", "space.json");
  if (!existsSync(spacePath)) {
    writeFileSync(
      spacePath,
      `${JSON.stringify({ schema: "team-comms/space@1" }, null, 2)}\n`,
      "utf8",
    );
  }

  // Round trip: streaming-mode drives can list a folder they cannot read from.
  const probeDir = join(config.commsRoot, "_meta", "agents");
  const probe = join(probeDir, `.probe-${config.agentId}-${rnd4()}`);
  try {
    writeFileSync(probe, "ok", "utf8");
    if (readFileSync(probe, "utf8") !== "ok") throw new Error("mismatch");
  } catch (error) {
    removeQuietly(probe);
    fail(
      `could not write and read back inside ${config.commsRoot} — ` +
        `make the folder available offline, then run init again. (${error})`,
    );
  }
  removeQuietly(probe);

  // Agent id collision: two people on the same id would break the one-writer
  // rule. It cannot be prevented, only noticed early.
  const agentFile = join(config.commsRoot, "_meta", "agents", `${config.agentId}.json`);
  let warning = "";
  if (existsSync(agentFile)) {
    try {
      const prior = JSON.parse(readFileSync(agentFile, "utf8"));
      if (prior && prior.person && prior.person !== config.person) {
        warning =
          `WARNING: ${config.agentId} is already registered to "${prior.person}". ` +
          `Pick a different agent id unless that is you.`;
      }
    } catch {
      // unreadable: fall through and rewrite our own entry
    }
  }
  writeFileSync(
    agentFile,
    `${JSON.stringify(
      {
        schema: "team-comms/agent@1",
        agentId: config.agentId,
        person: config.person,
        displayName: config.displayName,
        agent: config.agent,
        updated: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const configPath = join(projectRoot, ".claude", "team-comms.json");
  ensureDir(join(projectRoot, ".claude"));
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log(`space:  ${config.commsRoot}`);
  console.log(`agent:  ${config.agentId} (person: ${config.person})`);
  console.log(`config: ${configPath}`);
  console.log("round-trip read/write: ok");
  if (warning) console.log(warning);
  console.log(
    "\nNothing is injected into a session until you focus a thread:\n" +
      "  comms list            # see what is going on\n" +
      "  comms focus <thread>  # \"I am working in this thread now\"",
  );
}

// ---------------------------------------------------------------------
// open / post
// ---------------------------------------------------------------------

function bodyFrom(flags) {
  if (typeof flags["body-file"] === "string") {
    return readFileSync(flags["body-file"], "utf8");
  }
  if (typeof flags.body === "string") return flags.body;
  return "";
}

function cmdOpen(flags) {
  const config = requireConfig(flags);
  requireRoot(config);
  const title = typeof flags.title === "string" ? flags.title : "";
  const summary = typeof flags.summary === "string" ? flags.summary : "";
  if (!title) fail("--title \"<what this thread is about>\" is required.");
  if (!summary) fail("--summary \"<one or two lines>\" is required — it is what everyone else reads first.");

  const now = new Date();
  const stamp = utcStamp(now);
  const slug = slugify(typeof flags.slug === "string" ? flags.slug : title);
  const threadId = `${stamp.slice(0, 8)}-${slug}-${rnd4()}`;
  const month = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}`;
  const dir = join(threadsRoot(config), month, threadId);

  const post = composePost({
    threadId,
    kind: "open",
    config,
    title,
    summary,
    body: bodyFrom(flags),
    mentions: asList(flags.mention),
    authorKind: flags.human ? "human" : "ai",
    existingCount: 0,
    date: now,
  });
  publishFile(dir, post.name, post.content);
  publishMentions(config, threadId, post, asList(flags.mention), now);

  // Opening a thread is the clearest possible signal that you intend to work
  // in it, so focus follows automatically.
  const state = loadState();
  setFocus(state, config.projectRoot, threadId);
  markRead(state, threadId, [post.id]);
  saveState(state);

  console.log(`opened ${threadId}`);
  console.log(`  ${join(dir, post.name)}`);
  console.log(`focused on this thread for ${config.projectRoot}`);
}

function cmdPost(flags) {
  const config = requireConfig(flags);
  requireRoot(config);
  const state = loadState();

  let threadId = typeof flags.thread === "string" ? flags.thread : "";
  if (!threadId) {
    const focus = getFocus(state, config.projectRoot);
    if (focus) threadId = focus.thread;
  }
  if (!threadId) fail("--thread <id> is required (or focus a thread first).");
  if (!THREAD_ID_RE.test(threadId)) fail(`"${threadId}" is not a thread id.`);

  const dir = findThreadDir(config, threadId);
  if (!dir) fail(`thread ${threadId} not found under ${threadsRoot(config)}.`);

  const kind = typeof flags.kind === "string" ? flags.kind : "reply";
  if (!KINDS.includes(kind)) {
    fail(`--kind must be one of: ${KINDS.join(", ")}`);
  }
  const postState = typeof flags.state === "string" ? flags.state : "";
  if (postState && !STATES.includes(postState)) {
    fail(`--state must be one of: ${STATES.join(", ")}`);
  }
  if (kind === "status" && !postState) {
    fail("--kind status needs --state <open|discussing|decided|closed>.");
  }
  const summary = typeof flags.summary === "string" ? flags.summary : "";
  if (!summary) fail("--summary \"<one or two lines>\" is required.");

  const thread = readThread(String(dir), threadId);
  const attachPaths = asList(flags.attach);
  for (const path of attachPaths) {
    if (!existsSync(path)) fail(`attachment not found: ${path}`);
  }
  const attachNames = attachPaths.map((p) => basename(p));

  const now = new Date();
  const post = composePost({
    threadId,
    kind,
    config,
    summary,
    body: bodyFrom(flags),
    mentions: asList(flags.mention),
    attachments: attachNames,
    inReplyTo: typeof flags["in-reply-to"] === "string" ? flags["in-reply-to"] : undefined,
    state: postState,
    authorKind: flags.human ? "human" : "ai",
    existingCount: thread.count,
    date: now,
  });

  // Attachments go in first: the post that references them must never appear
  // before the files it points at.
  if (attachPaths.length) {
    const attachDir = join(String(dir), `${post.name.replace(/\.md$/, "")}.d`);
    for (const path of attachPaths) publishAttachment(attachDir, basename(path), path);
  }
  publishFile(String(dir), post.name, post.content);
  publishMentions(config, threadId, post, asList(flags.mention), now);

  markRead(state, threadId, [post.id]);
  saveState(state);

  console.log(`posted ${post.id} (${kind}) to ${threadId}`);
  console.log(`  ${join(String(dir), post.name)}`);
  if (attachNames.length) console.log(`  attachments: ${attachNames.join(", ")}`);
}

/** @param {any} config */
function publishMentions(config, threadId, post, mentions, date) {
  for (const target of mentions) {
    if (!AGENT_ID_RE.test(target)) continue;
    const pointer = composeMention(post, threadId, config, date);
    publishFile(mentionsDir(config, target), pointer.name, pointer.content);
  }
}

// ---------------------------------------------------------------------
// scan / list / read
// ---------------------------------------------------------------------

function gather(config, flags) {
  const state = loadState();
  const focus = getFocus(state, config.projectRoot);
  const threads = scanThreads(config, {
    full: Boolean(flags.full),
    cache: state.cache,
    extraThreadIds: focus ? [focus.thread] : [],
  });
  updateCache(state, threads);
  saveState(state);
  return { state, focus, threads };
}

function cmdScan(flags) {
  const config = requireConfig(flags);
  requireRoot(config);
  const { state, focus, threads } = gather(config, flags);

  const rows = threads.map((t) => ({
    thread: t.id,
    title: t.title,
    state: t.state,
    updated: t.updated,
    unread: unreadPosts(t, state, config.agentId).length,
    focused: focus?.thread === t.id,
  }));
  const mentions = unreadMentions(config, state);
  const { items: oddities, quarantine } = collectOddities(threads, config);

  if (flags.json) {
    console.log(JSON.stringify({ threads: rows, mentions, oddities }, null, 2));
    return;
  }

  const totalUnread = rows.reduce((sum, r) => sum + r.unread, 0);
  console.log(`${threads.length} thread(s), ${totalUnread} unread post(s) for ${config.agentId}`);
  if (mentions.length) console.log(`${mentions.length} mention(s) addressed to you`);
  if (focus) console.log(`focused: ${focus.thread}`);
  if (oddities.length) {
    console.log("");
    console.log(`${oddities.length} unexpected file(s) found — these should not exist:`);
    for (const odd of oddities) {
      console.log(`  ${odd.conflict ? "CONFLICT COPY" : "stray file  "} ${odd.thread}/${odd.name}`);
    }
    console.log(
      `Check them, then move them to ${quarantine} by hand. ` +
        `Nothing is moved automatically — deleting someone's writing is not this tool's call.`,
    );
  }
}

function cmdList(flags) {
  const config = requireConfig(flags);
  requireRoot(config);
  const { state, focus, threads } = gather(config, flags);

  const visible = flags.all ? threads : threads.filter((t) => t.state !== "closed");
  const rows = visible.map((t) => ({
    focused: focus?.thread === t.id,
    state: t.state,
    unread: unreadPosts(t, state, config.agentId).length,
    // Minute precision: seconds add a column and answer nothing, since sync
    // delay is measured in minutes anyway.
    updated: t.updated ? t.updated.slice(0, 16).replace("T", " ") : "",
    lastBy: t.lastBy || "",
    id: t.id,
    title: t.title,
    people: t.participants.join(","),
    decisions: t.decisions.length,
  }));

  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(flags.all ? "no threads yet." : "no open threads (try --all).");
    return;
  }
  console.log(
    `${pad("", 2)}${pad("STATE", 11)}${pad("UNREAD", 7)}${pad("UPDATED", 18)}${pad("LAST BY", 12)}${pad("THREAD", 34)}TITLE`,
  );
  for (const row of rows) {
    console.log(
      `${pad(row.focused ? "*" : "", 2)}${pad(row.state, 11)}${pad(String(row.unread || ""), 7)}` +
        `${pad(row.updated, 18)}${pad(row.lastBy, 12)}${pad(row.id, 34)}${row.title}` +
        `${row.decisions > 1 ? `  [${row.decisions} decisions]` : ""}`,
    );
  }
  console.log("");
  console.log("* = focused in this directory.  comms focus <thread> to switch.");
}

/** @param {string} text @param {number} width */
function pad(text, width) {
  const value = String(text ?? "");
  return value.length >= width ? `${value} ` : value + " ".repeat(width - value.length);
}

function cmdRead(flags, positional) {
  const config = requireConfig(flags);
  requireRoot(config);
  const state = loadState();

  let threadId = positional[0];
  if (!threadId) {
    const focus = getFocus(state, config.projectRoot);
    if (focus) threadId = focus.thread;
  }
  if (!threadId) fail("usage: comms read <thread-id>  (or focus a thread first)");

  const dir = findThreadDir(config, threadId);
  if (!dir) fail(`thread ${threadId} not found.`);
  const thread = readThread(String(dir), threadId);

  const unread = unreadPosts(thread, state, config.agentId);
  const unreadIds = new Set(unread.map((p) => p.id));
  const posts = flags.unread ? unread : thread.posts.filter((p) => p.known);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          thread: thread.id,
          title: thread.title,
          state: thread.state,
          participants: thread.participants,
          decisions: thread.decisions.length,
          posts: posts.map((p) => ({
            id: p.id,
            kind: p.kind,
            person: p.person,
            created: p.created,
            summary: p.summary,
            attachments: p.attachments,
            unread: unreadIds.has(p.id),
            body: flags.full ? p.body : undefined,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`# ${thread.title}`);
    console.log(
      `${thread.id} · ${thread.state} · ${thread.count} post(s) · ${thread.participants.join(", ")}`,
    );
    if (thread.decisions.length > 1) {
      console.log(
        `NOTE: ${thread.decisions.length} decisions were recorded. ` +
          `Sync delay means "latest" is not authoritative — a person has to pick.`,
      );
    }
    if (!posts.length) console.log("\n(nothing to show)");
    for (const post of posts) {
      console.log("");
      console.log(
        `--- ${post.created} · ${post.person} · ${post.kind}` +
          `${post.state ? ` -> ${post.state}` : ""}${unreadIds.has(post.id) ? "  [unread]" : ""}`,
      );
      console.log(post.summary);
      if (post.attachments.length) {
        console.log(`attachments: ${post.attachments.join(", ")}`);
        console.log(`  in ${join(thread.path, `${post.name.replace(/\.md$/, "")}.d`)}`);
      }
      if (flags.full) {
        const body = post.body.replace(/^##\s*(?:要旨|Summary)[\s\S]*?(?=^##\s|\Z)/m, "").trim();
        if (body) {
          console.log("");
          console.log(body);
        }
      }
    }
  }

  if (!flags["no-mark"]) {
    markRead(state, thread.id, thread.posts.map((p) => p.id));
    const stillMentioned = unreadMentions(config, state).filter((m) => m.thread === thread.id);
    markRead(state, "_mentions", stillMentioned.map((m) => m.key));
    saveState(state);
  }
}

// ---------------------------------------------------------------------
// catchup / digest
// ---------------------------------------------------------------------

/**
 * Restore a thread into a fresh session — incrementally.
 *
 * A session knows nothing about a thread it was not part of, and focus only
 * points at one; it does not remember its contents. Re-reading a long thread
 * every session is the one genuinely expensive thing this plugin can do, so a
 * saved digest is printed first and only the posts after it follow.
 */
function cmdCatchup(flags, positional) {
  const config = requireConfig(flags);
  requireRoot(config);
  const state = loadState();

  let threadId = positional[0];
  if (!threadId) {
    const focus = getFocus(state, config.projectRoot);
    if (focus) threadId = focus.thread;
  }
  if (!threadId) fail("usage: comms catchup <thread-id>  (or focus a thread first)");

  const dir = findThreadDir(config, threadId);
  if (!dir) fail(`thread ${threadId} not found.`);
  const thread = readThread(String(dir), threadId);
  const digest = flags.all ? null : loadDigest(threadId);
  const known = thread.posts.filter((p) => p.known);
  const since = digest?.upTo ?? "";
  const fresh = postsSinceDigest(digest, known);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          thread: thread.id,
          title: thread.title,
          state: thread.state,
          participants: thread.participants,
          decisions: thread.decisions.length,
          digest: digest ? { upTo: digest.upTo, covered: digest.covered, body: digest.body } : null,
          since,
          posts: fresh.map((p) => ({
            id: p.id,
            kind: p.kind,
            person: p.person,
            created: p.created,
            summary: p.summary,
            attachments: p.attachments,
            body: flags.full ? p.body : undefined,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`# ${thread.title}`);
  console.log(`${thread.id} · ${thread.state} · ${thread.count} post(s) · ${thread.participants.join(", ")}`);
  if (thread.decisions.length > 1) {
    console.log(`NOTE: ${thread.decisions.length} decisions recorded — a person has to pick.`);
  }

  if (digest) {
    console.log("");
    console.log(`## Digest so far (saved ${digest.savedAt}, covers ${digest.covered} post(s))`);
    console.log("");
    console.log(digest.body);
    console.log("");
    console.log(
      fresh.length
        ? `## ${fresh.length} post(s) since then`
        : "## Nothing new since that digest",
    );
  } else {
    console.log("");
    console.log(
      `## Whole thread (${known.length} post(s)) — no digest cached yet`,
    );
    console.log(
      `Write one with "comms digest ${thread.id} --file <path>" so the next session ` +
        `reads the digest plus what arrived after it, instead of all of this again.`,
    );
  }

  for (const post of fresh) {
    console.log("");
    console.log(
      `--- ${post.created} · ${post.person} · ${post.kind}${post.state ? ` -> ${post.state}` : ""}`,
    );
    console.log(post.summary);
    if (post.attachments.length) {
      console.log(`attachments: ${post.attachments.join(", ")}`);
      console.log(`  in ${join(thread.path, `${post.name.replace(/\.md$/, "")}.d`)}`);
    }
    if (flags.full) {
      const body = post.body.replace(/^##\s*(?:要旨|Summary)[\s\S]*?(?=^##\s|\Z)/m, "").trim();
      if (body) {
        console.log("");
        console.log(body);
      }
    }
  }

  if (!flags["no-mark"]) {
    markRead(state, thread.id, known.map((p) => p.id));
    saveState(state);
  }
}

/** Cache a digest of a thread, recording how far it reads. */
function cmdDigest(flags, positional) {
  const config = requireConfig(flags);
  requireRoot(config);
  const state = loadState();

  let threadId = positional[0];
  if (!threadId) {
    const focus = getFocus(state, config.projectRoot);
    if (focus) threadId = focus.thread;
  }
  if (!threadId) fail("usage: comms digest <thread-id> --file <path>");

  const dir = findThreadDir(config, threadId);
  if (!dir) fail(`thread ${threadId} not found.`);

  if (flags.show) {
    const existing = loadDigest(threadId);
    if (!existing) fail(`no digest cached for ${threadId}.`);
    console.log(existing.body);
    return;
  }

  const body = typeof flags.file === "string"
    ? readFileSync(flags.file, "utf8")
    : typeof flags.text === "string"
      ? flags.text
      : "";
  if (!body.trim()) fail("--file <path> (or --text) is required: the digest is written by you.");

  const thread = readThread(String(dir), threadId);
  const known = thread.posts.filter((p) => p.known);
  const saved = saveDigest(threadId, body, known);
  console.log(`digest saved for ${threadId} (covers ${saved.covered} post(s) up to ${saved.upTo})`);
  console.log(`  ${saved.path}`);
}

// ---------------------------------------------------------------------
// index / search
// ---------------------------------------------------------------------

function cmdIndex(flags) {
  const config = requireConfig(flags);
  requireRoot(config);
  const { state, focus, threads } = gather(config, flags);

  const rows = threads.map((t) => ({
    focused: focus?.thread === t.id,
    state: t.state,
    unread: unreadPosts(t, state, config.agentId).length,
    updated: t.updated ? t.updated.slice(0, 16).replace("T", " ") : "",
    lastBy: t.lastBy,
    id: t.id,
    title: t.title,
    people: t.participants.join(", "),
    decisions: t.decisions.length,
  }));

  const out = typeof flags.out === "string" ? flags.out : join(STATE_DIR, "index.html");
  ensureDir(dirname(out));
  writeFileSync(
    out,
    renderIndexHtml({
      rows,
      agentId: config.agentId,
      commsRoot: config.commsRoot,
      mentions: unreadMentions(config, state).length,
    }),
    "utf8",
  );
  console.log(`wrote ${rows.length} thread(s) to ${out}`);
}

function cmdSearch(flags, positional) {
  const config = requireConfig(flags);
  requireRoot(config);
  const query = positional.join(" ").trim();
  if (!query) fail("usage: comms search <text>");
  const needle = query.toLowerCase();

  const { state, threads } = gather(config, { ...flags, full: true });
  const hits = [];
  for (const thread of threads) {
    for (const post of thread.posts) {
      if (!post.known) continue;
      const haystack = `${post.summary}\n${post.body}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
      hits.push({
        thread: thread.id,
        title: thread.title,
        state: thread.state,
        person: post.person,
        kind: post.kind,
        created: post.created,
        summary: post.summary,
        file: post.file,
      });
    }
  }
  hits.sort((a, b) => (a.created > b.created ? -1 : 1));

  if (flags.json) {
    console.log(JSON.stringify(hits, null, 2));
    return;
  }
  if (!hits.length) {
    console.log(`no post matches "${query}".`);
    return;
  }
  console.log(`${hits.length} match(es) for "${query}"`);
  for (const hit of hits) {
    console.log("");
    console.log(`${hit.created} · ${hit.person} · ${hit.kind} · ${hit.thread} (${hit.state})`);
    console.log(`  ${hit.title} — ${hit.summary}`);
  }
  void state;
}

// ---------------------------------------------------------------------
// focus
// ---------------------------------------------------------------------

function cmdFocus(flags, positional) {
  const config = requireConfig(flags);
  const state = loadState();
  const threadId = positional[0];
  if (!threadId) {
    const focus = getFocus(state, config.projectRoot);
    console.log(focus ? `focused: ${focus.thread}` : "not focused on any thread.");
    return;
  }
  if (!THREAD_ID_RE.test(threadId)) fail(`"${threadId}" is not a thread id.`);
  requireRoot(config);
  if (!findThreadDir(config, threadId)) fail(`thread ${threadId} not found.`);
  setFocus(state, config.projectRoot, threadId);
  saveState(state);
  console.log(`focused on ${threadId} for ${config.projectRoot}`);
  console.log("Session start will now surface this thread's unread posts here, and nothing else.");
}

function cmdUnfocus(flags) {
  const config = requireConfig(flags);
  const state = loadState();
  setFocus(state, config.projectRoot, null);
  saveState(state);
  console.log(`unfocused for ${config.projectRoot} — sessions here will stay silent.`);
}

// ---------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional.shift();

try {
  switch (command) {
    case "init":
      cmdInit(flags);
      break;
    case "open":
      cmdOpen(flags);
      break;
    case "post":
      cmdPost(flags);
      break;
    case "scan":
      cmdScan(flags);
      break;
    case "list":
      cmdList(flags);
      break;
    case "read":
      cmdRead(flags, positional);
      break;
    case "catchup":
      cmdCatchup(flags, positional);
      break;
    case "digest":
      cmdDigest(flags, positional);
      break;
    case "index":
      cmdIndex(flags);
      break;
    case "search":
      cmdSearch(flags, positional);
      break;
    case "focus":
      cmdFocus(flags, positional);
      break;
    case "unfocus":
      cmdUnfocus(flags);
      break;
    default:
      console.log(
        [
          "team-comms — asynchronous discussion over a shared folder.",
          "",
          "  comms init --root <path> --agent-id <person>-<machine>",
          "  comms open --title <title> --summary <one-liner> [--mention <agent>]",
          "  comms post [--thread <id>] [--kind reply] --summary <one-liner>",
          "             [--body-file <path>] [--attach <path>] [--mention <agent>]",
          "  comms scan [--full]         check for new posts and stray files",
          "  comms list [--all]          threads, state, unread count",
          "  comms read <thread-id> [--full] [--unread]",
          "  comms catchup [<thread-id>] [--full] [--all]",
          "                              cached digest + only what arrived since",
          "  comms digest [<thread-id>] --file <path> | --show",
          "                              cache a digest so the next catch-up is incremental",
          "  comms index [--out <path>]  write the thread list as local HTML",
          "  comms search <text>         search summaries and bodies",
          "  comms focus <thread-id> | comms unfocus",
          "",
          `  kinds:  ${KINDS.join(", ")}`,
          `  states: ${STATES.join(", ")}`,
        ].join("\n"),
      );
      process.exit(command ? 1 : 0);
  }
} catch (error) {
  fail(String(error && error.stack ? error.stack : error));
}
