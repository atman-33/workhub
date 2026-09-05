/**
 * `task-cli start/report/sessions` — the per-session active-task marker.
 *
 * The marker used to be one shared `_ai/memory/active-task.json`, and two
 * sessions running at once silently overwrote each other: the Stop-hook
 * reminder named the wrong task and the memory engine filed a transcript
 * under a task the session had never touched. The collision is invisible in
 * review — nothing errors, the wrong id is simply recorded — which is why the
 * isolation is pinned here rather than left to inspection.
 *
 * The CLI is a script with a top-level dispatch, so it cannot be imported;
 * these drive the real command line, which is also what the skills do.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./task-cli.mjs", import.meta.url));

let vault;

function seed({ id, title, status = "todo" }) {
  const front = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `status: ${status}`,
    "assignee: claude-code",
    "project: ",
    "priority: medium",
    "due: ",
    "tags: []",
    "created: 2026-01-01",
    "updated: 2026-01-01",
    "---",
    "",
    "## Description",
    "",
  ].join("\n");
  writeFileSync(join(vault, "tasks", `${id} ${title}.md`), front, "utf-8");
}

/** Run the CLI as if it were a session with `session` / `host` ids. */
function run(session, args) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_HOST_SESSION_ID;
  if (session) {
    env.CLAUDE_CODE_SESSION_ID = session.id;
    if (session.host) env.CLAUDE_CODE_HOST_SESSION_ID = session.host;
  }
  return execFileSync(process.execPath, [CLI, ...args, "--vault", vault], {
    encoding: "utf-8",
    env,
  });
}

function markerFile(key) {
  return join(vault, "_ai", "memory", "sessions", `${key}.json`);
}

function marker(key) {
  return JSON.parse(readFileSync(markerFile(key), "utf-8"));
}

const A = { id: "aaaa1111", host: "local_aaaa" };
const B = { id: "bbbb2222", host: "local_bbbb" };

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "task-cli-sessions-"));
  mkdirSync(join(vault, "tasks", "archive"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
  seed({ id: "T-0001", title: "alpha" });
  seed({ id: "T-0002", title: "beta" });
});

describe("start", () => {
  it("keeps two parallel sessions' markers apart", () => {
    run(A, ["start", "T-0001"]);
    run(B, ["start", "T-0002"]);
    expect(marker(A.id).id).toBe("T-0001");
    expect(marker(B.id).id).toBe("T-0002");
  });

  it("records the address another session sends to", () => {
    run(A, ["start", "T-0001"]);
    expect(marker(A.id)).toMatchObject({ session_id: A.id, host_session_id: A.host });
  });

  // Outside the desktop app there is no address, and the entry has to say so
  // rather than carry a stale one.
  it("records an empty address when the host id is absent", () => {
    run({ id: A.id }, ["start", "T-0001"]);
    expect(marker(A.id).host_session_id).toBe("");
  });

  // OpenCode and bare terminals export no session id. They share one bucket,
  // which is correct: they cannot be addressed either.
  it("falls back to a single default marker without a session id", () => {
    run(null, ["start", "T-0001"]);
    expect(marker("default").id).toBe("T-0001");
  });

  // A leftover file that still looks authoritative is worse than none.
  it("removes the pre-T-0243 shared marker", () => {
    const legacy = join(vault, "_ai", "memory", "active-task.json");
    mkdirSync(join(vault, "_ai", "memory"), { recursive: true });
    writeFileSync(legacy, JSON.stringify({ id: "T-0002" }), "utf-8");
    run(A, ["start", "T-0001"]);
    expect(existsSync(legacy)).toBe(false);
  });
});

describe("report", () => {
  it("clears only the reported task's marker", () => {
    run(A, ["start", "T-0001"]);
    run(B, ["start", "T-0002"]);
    run(A, ["report", "T-0001"]);
    expect(existsSync(markerFile(A.id))).toBe(false);
    expect(marker(B.id).id).toBe("T-0002");
  });

  // A task started in one session is routinely reported from another (a
  // resume, or a different agent CLI); the stale marker still has to go.
  it("clears a marker written by a different session", () => {
    run(A, ["start", "T-0001"]);
    run(B, ["report", "T-0001"]);
    expect(existsSync(markerFile(A.id))).toBe(false);
  });
});

describe("sessions", () => {
  it("lists who is working what, and marks this session", () => {
    run(A, ["start", "T-0001"]);
    run(B, ["start", "T-0002"]);
    const rows = JSON.parse(run(A, ["sessions", "--json"]));
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.task === "T-0001");
    const b = rows.find((r) => r.task === "T-0002");
    expect(a).toMatchObject({ title: "alpha", host_session_id: A.host, self: true });
    expect(b).toMatchObject({ title: "beta", host_session_id: B.host, self: false });
  });

  it("reports an empty vault rather than failing", () => {
    expect(run(A, ["sessions"])).toContain("no session is working a task");
  });
});
