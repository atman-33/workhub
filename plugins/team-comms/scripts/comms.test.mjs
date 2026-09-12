/**
 * team-comms — the invariants that make a cloud-synced folder safe to write to
 * from several machines at once.
 *
 * These drive the real CLI and the real SessionStart hook, because that is what
 * the skills do. The things pinned here are the ones whose breakage is
 * invisible in review: nothing errors, a file is simply overwritten, or a
 * session is simply told something it should not have been told.
 *
 * Two agents are simulated by two project directories with their own config,
 * plus `TEAM_COMMS_STATE_DIR` so each keeps its own read markers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./comms.mjs", import.meta.url));
const HOOK = fileURLToPath(new URL("../hooks/scripts/comms-notify.mjs", import.meta.url));

let space;
/** @type {{ root: string, state: string }} */
let alice;
/** @type {{ root: string, state: string }} */
let bob;

function makeAgent(name) {
  const base = mkdtempSync(join(os.tmpdir(), `tc-${name}-`));
  const root = join(base, "repo");
  const state = join(base, "state");
  mkdirSync(root, { recursive: true });
  mkdirSync(state, { recursive: true });
  return { root, state };
}

/** Run the CLI as one agent. Returns stdout; throws with stderr on failure. */
function run(agent, args, options = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: agent.root,
    env: {
      ...process.env,
      TEAM_COMMS_STATE_DIR: agent.state,
      CLAUDE_PROJECT_DIR: agent.root,
      ...options.env,
    },
  });
}

/** Run the SessionStart hook as one agent and return the injected text. */
function hook(agent) {
  const out = execFileSync(process.execPath, [HOOK], {
    encoding: "utf8",
    cwd: agent.root,
    input: JSON.stringify({ cwd: agent.root }),
    env: { ...process.env, TEAM_COMMS_STATE_DIR: agent.state, CLAUDE_PROJECT_DIR: agent.root },
  });
  const payload = JSON.parse(out || "{}");
  return payload.hookSpecificOutput?.additionalContext ?? "";
}

function threadIdFrom(stdout) {
  const m = /opened (\d{8}-[a-z0-9-]+-[a-z0-9]{4})/.exec(stdout);
  if (!m) throw new Error(`no thread id in: ${stdout}`);
  return m[1];
}

function threadDir(threadId) {
  const month = `${threadId.slice(0, 4)}-${threadId.slice(4, 6)}`;
  return join(space, "threads", month, threadId);
}

function postFiles(threadId) {
  return readdirSync(threadDir(threadId)).filter((n) => /^\d{3}-/.test(n));
}

beforeEach(() => {
  space = mkdtempSync(join(os.tmpdir(), "tc-space-"));
  alice = makeAgent("alice");
  bob = makeAgent("bob");
  run(alice, ["init", "--root", space, "--agent-id", "alice-desktop", "--person", "alice"]);
  run(bob, ["init", "--root", space, "--agent-id", "bob-laptop", "--person", "bob"]);
});

describe("conflict avoidance", () => {
  it("gives two agents posting at the same moment different filenames", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "which scheme?"]));

    run(alice, ["post", "--thread", threadId, "--summary", "A is cheaper"]);
    run(bob, ["post", "--thread", threadId, "--summary", "but B is simpler"]);

    const files = postFiles(threadId);
    expect(files).toHaveLength(3);
    expect(new Set(files).size).toBe(3);
    // The agent id is in every path: that is what makes a collision impossible
    // rather than merely unlikely.
    expect(files.filter((n) => n.includes("alice-desktop"))).toHaveLength(2);
    expect(files.filter((n) => n.includes("bob-laptop"))).toHaveLength(1);
  });

  it("never modifies a file that already exists", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "which scheme?"]));
    const first = postFiles(threadId)[0];
    const before = readFileSync(join(threadDir(threadId), first), "utf8");

    run(bob, ["post", "--thread", threadId, "--summary", "replying"]);
    run(bob, ["post", "--thread", threadId, "--kind", "decision", "--summary", "we take B"]);
    run(alice, ["read", threadId]);

    expect(readFileSync(join(threadDir(threadId), first), "utf8")).toBe(before);
  });

  it("leaves no temp file behind and ignores one that lingers", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    // A half-synced temp file must be invisible to readers, not a parse error.
    writeFileSync(join(threadDir(threadId), ".tmp-halfwritten"), "---\nbroken", "utf8");

    expect(readdirSync(threadDir(threadId)).filter((n) => /^\d{3}-/.test(n))).toHaveLength(1);
    const out = run(bob, ["read", threadId, "--json"]);
    expect(JSON.parse(out).posts).toHaveLength(1);
  });

  it("reports a sync conflict copy instead of silently absorbing it", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    const original = postFiles(threadId)[0];
    writeFileSync(
      join(threadDir(threadId), original.replace(/\.md$/, " (1).md")),
      readFileSync(join(threadDir(threadId), original), "utf8"),
      "utf8",
    );

    const out = run(bob, ["scan"]);
    expect(out).toMatch(/CONFLICT COPY/);
    expect(out).toMatch(/_quarantine/);
    // Detected only — moving someone's file is a human decision.
    expect(readdirSync(threadDir(threadId)).some((n) => n.includes("(1)"))).toBe(true);
  });
});

describe("thread state is folded, never stored", () => {
  it("derives state, participants and decisions from the posts", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(bob, ["post", "--thread", threadId, "--summary", "B please"]);
    run(alice, ["post", "--thread", threadId, "--kind", "decision", "--summary", "B it is"]);

    const view = JSON.parse(run(alice, ["read", threadId, "--json"]));
    expect(view.state).toBe("decided");
    expect(view.participants.sort()).toEqual(["alice", "bob"]);
    expect(view.decisions).toBe(1);
    // No status file, no participants file: nothing in the space is mutable.
    expect(existsSync(join(threadDir(threadId), "status.json"))).toBe(false);
  });

  it("says so when two decisions exist rather than picking the later one", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(alice, ["post", "--thread", threadId, "--kind", "decision", "--summary", "we take A"]);
    run(bob, ["post", "--thread", threadId, "--kind", "decision", "--summary", "we take B"]);

    const out = run(alice, ["read", threadId]);
    expect(out).toMatch(/2 decisions were recorded/);
    expect(JSON.parse(run(alice, ["read", threadId, "--json"])).decisions).toBe(2);
  });

  it("closes a thread through a status post", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(alice, ["post", "--thread", threadId, "--kind", "status", "--state", "closed", "--summary", "done"]);

    expect(JSON.parse(run(bob, ["read", threadId, "--json"])).state).toBe("closed");
    expect(run(bob, ["list"])).not.toMatch(threadId);
    expect(run(bob, ["list", "--all"])).toMatch(threadId);
  });
});

describe("unread tracking", () => {
  it("counts other people's posts, never your own", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(alice, ["post", "--thread", threadId, "--summary", "also this"]);

    expect(JSON.parse(run(alice, ["scan", "--json"])).threads[0].unread).toBe(0);
    expect(JSON.parse(run(bob, ["scan", "--json"])).threads[0].unread).toBe(2);

    run(bob, ["read", threadId]);
    expect(JSON.parse(run(bob, ["scan", "--json"])).threads[0].unread).toBe(0);
  });

  it("keeps read markers out of the shared space", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    const before = postFiles(threadId).length;
    run(bob, ["read", threadId]);
    run(bob, ["scan"]);
    // Reading is a local act: it must not write one byte to the shared folder.
    expect(postFiles(threadId).length).toBe(before);
    expect(existsSync(join(bob.state, "state.json"))).toBe(true);
  });
});

describe("long-lived threads", () => {
  it("finds new posts on a thread created months ago", () => {
    // The month partition is keyed on creation date, so the most active thread
    // can live in the oldest folder. Scanning only recent months would drop it.
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    const oldMonthDir = join(space, "threads", "2024-01", threadId);
    mkdirSync(join(space, "threads", "2024-01"), { recursive: true });
    execFileSync(process.execPath, [
      "-e",
      `require("node:fs").cpSync(${JSON.stringify(threadDir(threadId))}, ${JSON.stringify(oldMonthDir)}, {recursive:true}); require("node:fs").rmSync(${JSON.stringify(threadDir(threadId))}, {recursive:true, force:true});`,
    ]);

    const rows = JSON.parse(run(bob, ["scan", "--full", "--json"])).threads;
    expect(rows.map((r) => r.thread)).toContain(threadId);

    run(bob, ["post", "--thread", threadId, "--summary", "still discussing"]);
    // Alice's cache now knows the thread, so a plain scan must still see it.
    const seen = JSON.parse(run(alice, ["scan", "--json"])).threads;
    expect(seen.map((r) => r.thread)).toContain(threadId);
  });
});

describe("attachments", () => {
  it("stores the document beside the post and lists it", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    const report = join(alice.root, "report.md");
    writeFileSync(report, "# comparison\n\nlong research output\n", "utf8");

    run(alice, [
      "post", "--thread", threadId, "--kind", "share",
      "--summary", "compared three schemes", "--attach", report,
    ]);

    const post = postFiles(threadId).find((n) => n.includes("-share-"));
    const dir = join(threadDir(threadId), post.replace(/\.md$/, ".d"));
    expect(readFileSync(join(dir, "report.md"), "utf8")).toMatch(/long research output/);
    // The summary is what a reader sees first; the body is opt-in.
    expect(run(bob, ["read", threadId])).toMatch(/attachments: report\.md/);
  });
});

describe("the SessionStart hook", () => {
  it("says nothing at all when no thread is focused", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(alice, ["post", "--thread", threadId, "--summary", "unread for bob"]);

    expect(hook(bob)).toBe("");
  });

  it("injects only the focused thread's unread posts", () => {
    const focused = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "auth question"]));
    const other = threadIdFrom(run(alice, ["open", "--title", "deploy", "--summary", "deploy question"]));
    run(alice, ["post", "--thread", focused, "--summary", "focused detail"]);
    run(alice, ["post", "--thread", other, "--summary", "unrelated detail"]);

    run(bob, ["focus", focused]);
    const injected = hook(bob);
    expect(injected).toMatch(/focused detail/);
    expect(injected).not.toMatch(/unrelated detail/);
    expect(injected).not.toMatch(other);
  });

  it("reports a mention as a single line even with no focus", () => {
    const threadId = threadIdFrom(
      run(alice, ["open", "--title", "auth", "--summary", "q", "--mention", "bob-laptop"]),
    );
    const injected = hook(bob);
    expect(injected).toMatch(/<mentions count="1"/);
    // A count, not the content: the opt-in line is only crossed this far.
    expect(injected).not.toMatch(threadId);
    // Alice opened the thread, so she is focused on it — and has nothing
    // unread, since a mention never points back at its own author.
    expect(hook(alice)).not.toMatch(/<mentions/);
  });

  it("caps how much it injects", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    for (let i = 0; i < 14; i += 1) {
      run(alice, ["post", "--thread", threadId, "--summary", `point number ${i}`]);
    }
    run(bob, ["focus", threadId]);
    const injected = hook(bob);
    expect((injected.match(/<unread /g) ?? []).length).toBe(10);
    expect(injected).toMatch(/further unread post\(s\) not listed/);
  });

  it("drops focus once the thread is closed, and then stays silent", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(bob, ["focus", threadId]);
    run(alice, ["post", "--thread", threadId, "--kind", "status", "--state", "closed", "--summary", "done"]);

    expect(hook(bob)).toMatch(/is closed, so focus has been cleared/);
    expect(hook(bob)).toBe("");
  });

  it("survives an unreachable shared folder without breaking the session", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(bob, ["focus", threadId]);
    writeFileSync(
      join(bob.root, ".claude", "team-comms.json"),
      JSON.stringify({ ...JSON.parse(readFileSync(join(bob.root, ".claude", "team-comms.json"), "utf8")), commsRoot: join(space, "gone") }),
      "utf8",
    );

    expect(hook(bob)).toMatch(/is not available/);
  });

  it("says nothing in a project that was never set up", () => {
    const stranger = makeAgent("stranger");
    expect(hook(stranger)).toBe("");
  });
});

describe("catch-up", () => {
  it("shows the whole thread when no digest is cached, and only the rest afterwards", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "which scheme"]));
    run(alice, ["post", "--thread", threadId, "--summary", "point one"]);
    run(alice, ["post", "--thread", threadId, "--summary", "point two"]);

    const cold = run(bob, ["catchup", threadId]);
    expect(cold).toMatch(/no digest cached yet/);
    expect(cold).toMatch(/point one/);

    writeFileSync(join(bob.root, "digest.md"), "alice raised two points.\n", "utf8");
    run(bob, ["digest", threadId, "--file", join(bob.root, "digest.md")]);
    run(alice, ["post", "--thread", threadId, "--summary", "point three"]);

    const warm = run(bob, ["catchup", threadId]);
    expect(warm).toMatch(/alice raised two points/);
    expect(warm).toMatch(/point three/);
    // The point of the digest: what it already covers is not re-read.
    expect(warm).not.toMatch(/point one/);
  });

  it("does not lose a post written in the same second as the digest cutoff", () => {
    // Timestamps resolve to the second, so a plain "newer than the cutoff"
    // comparison drops a post that landed in that same second — permanently,
    // and with no symptom other than a missing contribution.
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    writeFileSync(join(bob.root, "digest.md"), "just the opening question.\n", "utf8");
    run(bob, ["digest", threadId, "--file", join(bob.root, "digest.md")]);
    run(alice, ["post", "--thread", threadId, "--summary", "landed in the same second"]);

    const view = JSON.parse(run(bob, ["catchup", threadId, "--json"]));
    expect(view.posts.map((p) => p.summary)).toContain("landed in the same second");
  });

  it("keeps posts made in one second in the order they were written", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    for (const n of ["first", "second", "third"]) {
      run(alice, ["post", "--thread", threadId, "--summary", n]);
    }
    const posts = JSON.parse(run(bob, ["read", threadId, "--json"])).posts;
    expect(posts.map((p) => p.summary)).toEqual(["q", "first", "second", "third"]);
  });
});

describe("the thread list", () => {
  it("is written locally, never into the shared space", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    const out = join(alice.root, "index.html");
    run(alice, ["index", "--out", out]);

    const html = readFileSync(out, "utf8");
    expect(html).toMatch(threadId);
    expect(html).toMatch(/auth/);
    // A shared index file would be the one thing everybody rewrites — exactly
    // the conflict the rest of the design removes.
    expect(readdirSync(space).filter((n) => n.endsWith(".html"))).toHaveLength(0);
  });

  it("finds a post by its summary", () => {
    const threadId = threadIdFrom(run(alice, ["open", "--title", "auth", "--summary", "q"]));
    run(alice, ["post", "--thread", threadId, "--summary", "device flow is operationally heavy"]);

    const hits = JSON.parse(run(bob, ["search", "operationally", "--json"]));
    expect(hits).toHaveLength(1);
    expect(hits[0].thread).toBe(threadId);
  });
});

describe("init", () => {
  it("warns when an agent id is already registered to someone else", () => {
    const carol = makeAgent("carol");
    const out = run(carol, ["init", "--root", space, "--agent-id", "alice-desktop", "--person", "carol"]);
    expect(out).toMatch(/already registered to "alice"/);
  });

  it("refuses an agent id that a case-insensitive filesystem could collide on", () => {
    const carol = makeAgent("carol");
    expect(() => run(carol, ["init", "--root", space, "--agent-id", "Carol_PC"])).toThrow();
  });
});
