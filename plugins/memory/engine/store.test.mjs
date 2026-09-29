/**
 * The `memory/` store, the session brief and the checkpoint (T-0369).
 *
 * What is worth pinning is the behaviour the design turns on, not the wording:
 * the brief asks structurally rather than by similarity, a checkpoint rewrites
 * its own note instead of accumulating, archiving keeps a note rather than
 * losing it, and a cap reports without enforcing.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBrief } from "./lib/brief.mjs";
import { extractTail, renderCheckpoint, writeCheckpoint } from "./lib/checkpoint.mjs";
import { parseNote } from "./lib/note.mjs";
import { validateNote } from "./lib/schema.mjs";
import {
  NOTES_INDEX_THRESHOLD,
  archiveNote,
  axisUsage,
  capFindings,
  hasStore,
  policyEntries,
  query,
  readLayer,
  searchNotes,
} from "./lib/store.mjs";

let vault;
let previousHome;

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "workhub-store-"));
  for (const layer of ["identity", "notes", "episodes"]) {
    mkdirSync(join(vault, "memory", layer), { recursive: true });
  }
  previousHome = process.env.WORKHUB_ENGINE_HOME;
  process.env.WORKHUB_ENGINE_HOME = vault;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.WORKHUB_ENGINE_HOME;
  else process.env.WORKHUB_ENGINE_HOME = previousHome;
  rmSync(vault, { recursive: true, force: true });
});

function note(layer, name, text) {
  const path = join(vault, "memory", layer, `${name}.md`);
  writeFileSync(path, text, "utf8");
  return path;
}

const OPEN_DECISION = `---
title: Rate limiting
type: decision
status: open
---
# Rate limiting
- [decision] Token bucket over a fixed window
- [rationale] Bursts at the boundary
- [alternative] Fixed window
`;

const SETTLED_DECISION = `---
title: Storage engine
type: decision
status: accepted
---
# Storage engine
- [decision] SQLite
`;

describe("the store", () => {
  it("knows whether a vault has one", () => {
    expect(hasStore(vault)).toBe(true);
    expect(hasStore(join(vault, "nope"))).toBe(false);
  });

  it("answers a structured query and ignores everything else", () => {
    note("notes", "rate-limiting", OPEN_DECISION);
    note("notes", "storage", SETTLED_DECISION);
    note("notes", "loose", "---\ntitle: Loose\n---\n# Loose\n- [fact] untyped\n");

    const open = query(vault, ["notes"], { type: "decision", status: "open" });
    expect(open.map((n) => n.frontmatter.title)).toEqual(["Rate limiting"]);
  });

  it("skips a note it cannot parse instead of throwing", () => {
    note("notes", "ok", OPEN_DECISION);
    note("notes", "weird", "not really a note at all");
    expect(() => readLayer(vault, "notes")).not.toThrow();
    expect(readLayer(vault, "notes")).toHaveLength(2);
  });

  it("archives a note instead of losing it", () => {
    const path = note("notes", "done", SETTLED_DECISION);
    const moved = archiveNote(vault, path);

    expect(existsSync(path)).toBe(false);
    expect(existsSync(moved)).toBe(true);
    // The content survives: an archived note keeps its observations and its
    // inbound links resolvable.
    expect(readFileSync(moved, "utf8")).toContain("[decision] SQLite");
  });

  it("does not collide when the same name is archived twice", () => {
    const first = archiveNote(vault, note("notes", "dup", SETTLED_DECISION));
    const second = archiveNote(vault, note("notes", "dup", SETTLED_DECISION));
    expect(second).not.toBe(first);
    expect(existsSync(first)).toBe(true);
  });
});

describe("caps", () => {
  it("says nothing while a layer is within its cap", () => {
    note("identity", "about-me", "---\ntitle: Me\n---\n# Me\nshort\n");
    expect(capFindings(vault)).toEqual([]);
  });

  it("reports an over-long identity note, with what to do about it", () => {
    const long = `---\ntitle: Me\n---\n# Me\n${"line\n".repeat(200)}`;
    note("identity", "about-me", long);

    const findings = capFindings(vault);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/cap 120/);
    expect(findings[0].fix).toBeTruthy();
  });

  it("reports rather than enforces — the note is left alone", () => {
    // Which rule survives a merge is the owner's call. Dropping one
    // automatically is exactly the silent edit this design exists to avoid.
    const path = note("identity", "about-me", `---\ntitle: Me\n---\n# Me\n${"line\n".repeat(200)}`);
    capFindings(vault);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8").split("\n").length).toBeGreaterThan(200);
  });
});

// The decision policy's limit is one count of entries across every section
// (T-0458): not lines, and not a quota per section. Until T-0375 the count
// lived only in kb-lint's prose, so nothing that runs code ever checked it.
describe("decision policy caps", () => {
  const entry = (i, extra = 0) => `- P-${String(i).padStart(2, "0")} Rule ${i}.\n${"  more\n".repeat(extra)}`;
  const policy = (entries, { before = "", fm = "" } = {}) =>
    `---\ntitle: Policy\n${fm}---\n# Policy\nPreamble.\n- not an entry, it is above the first section\n\n## Preferences\n${before}\n${entries.join("")}\n## Gray-zone principles\n1. P-90 A numbered one.\n`;
  const many = (n, extra = 0) => Array.from({ length: n }, (_, i) => entry(i + 1, extra));

  it("reads entries from every section, numbered ones too, continuation lines included", () => {
    const entries = policyEntries(policy([entry(1, 2)]));
    expect(entries.map((e) => [e.section, e.id])).toEqual([
      ["Preferences", "P-01"],
      ["Gray-zone principles", "P-90"],
    ]);
    expect(entries[0].lines).toHaveLength(3);
  });

  it("ends a continuation at a blank line, so an indented example is not an entry's line", () => {
    const text = [
      "## A",
      "- P-01 Rule.",
      "  more",
      "",
      "<!-- e.g.",
      "     - P-02 an example",
      "       spills over -->",
    ].join("\n");
    const entries = policyEntries(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].lines).toHaveLength(2);
  });

  it("passes the policy the vault template ships with", () => {
    const shipped = readFileSync(
      new URL("../../../vault-template/memory/identity/decision-policy.md", import.meta.url),
      "utf8",
    );
    note("identity", "decision-policy", shipped);
    expect(capFindings(vault)).toEqual([]);
  });

  it("says nothing for a policy at its cap of fifty entries of three lines", () => {
    // 49 here plus the numbered entry after the last heading makes fifty.
    note("identity", "decision-policy", policy(many(49, 2)));
    expect(capFindings(vault)).toEqual([]);
  });

  it("reports a fifty-first entry, wherever it lands", () => {
    note("identity", "decision-policy", policy(many(50)));
    expect(capFindings(vault).map((f) => f.cap)).toEqual(["policy entries"]);
  });

  it("reports an entry that runs past three lines", () => {
    note("identity", "decision-policy", policy([entry(1, 3)]));
    expect(capFindings(vault).map((f) => f.cap)).toEqual(["policy entry P-01"]);
  });

  it("reports an entry with no id and one whose id is used twice", () => {
    note("identity", "decision-policy", policy(["- No id here.\n", entry(2), entry(2)]));
    const finding = capFindings(vault).find((f) => f.cap === "policy ids");
    expect(finding.detail).toMatch(/1 without a P-NN id/);
    expect(finding.detail).toMatch(/duplicated: P-02/);
  });

  it("does not hold the policy to the identity line cap", () => {
    // Forty entries of three lines is far past 120 lines, on purpose.
    note("identity", "decision-policy", policy(many(49, 2)));
    expect(capFindings(vault).some((f) => f.cap.startsWith("identity/"))).toBe(false);
  });

  it("reports a case written into the policy instead of into notes/", () => {
    const before = "- 2026-09-01 T-0042 use tabs\n  (from: the formatter question)\n";
    note("identity", "decision-policy", policy([entry(1)], { before }));
    expect(capFindings(vault).map((f) => f.cap)).toContain("policy cases");
  });
});

describe("axis usage", () => {
  const NOW = Date.parse("2026-12-31");
  const policy = (since) =>
    `---\ntitle: Policy\n${since ? `axes_since: ${since}\n` : ""}---\n# Policy\n## Always ask\n- P-01 Delete only after asking.\n## Preferences\n- P-02 Cited one.\n- P-03 Cited too long ago.\n- P-04 Never cited.\n`;
  const cite = (folder, name, date, ids) => {
    const dir = folder === "comms" ? join(vault, "_ai", "comms") : join(vault, "memory", "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), `---\ntitle: ${name}\ndecided: ${date}\n---\nbasis: ${ids.join(", ")}\n`);
  };

  it("is off when the policy does not say when counting started", () => {
    note("identity", "decision-policy", policy(""));
    expect(axisUsage(vault, { now: NOW }).status).toBe("off");
  });

  it("reports nothing until a full window has passed since counting started", () => {
    note("identity", "decision-policy", policy("2026-12-01"));
    expect(axisUsage(vault, { now: NOW })).toEqual({ status: "collecting", since: "2026-12-01", remaining: 60 });
  });

  it("lists entries nobody cited in the window, and never one from Always ask", () => {
    note("identity", "decision-policy", policy("2026-09-30"));
    cite("notes", "recent", "2026-12-20", ["P-02"]);
    cite("comms", "Q-0001", "2026-11-15", ["P-02", "P-99"]);
    cite("notes", "old", "2026-06-01", ["P-03"]);

    const usage = axisUsage(vault, { now: NOW });
    expect(usage.status).toBe("ready");
    expect(usage.cited["P-02"]).toBe(2);
    // P-03 was only cited outside the window; P-01 is exempt.
    expect(usage.unused.map((e) => e.id)).toEqual(["P-03", "P-04"]);
  });
});

describe("searchNotes", () => {
  const decision = (title, status, extra = "") =>
    `---\ntitle: ${title}\ntype: decision\nstatus: ${status}\n---\n# ${title}\n- [decision] ${title}\n${extra}`;

  it("requires every term, in the title or the body", () => {
    note("notes", "a", decision("Tabs over spaces", "accepted", "formatter settled\n"));
    note("notes", "b", decision("Spaces in YAML", "accepted"));
    expect(searchNotes(vault, { text: "spaces formatter" }).map((n) => n.slug)).toEqual(["a"]);
  });

  it("filters on type and status before matching text", () => {
    note("notes", "a", decision("Rate limit", "open"));
    note("notes", "b", decision("Rate limit history", "accepted"));
    note("notes", "c", "---\ntitle: Rate limit lesson\ntype: lesson\n---\n# x\n");
    expect(searchNotes(vault, { type: "decision", status: "open" }).map((n) => n.slug)).toEqual(["a"]);
  });

  it("leaves a superseded decision out unless it is asked for", () => {
    // Answering from a call the owner has since reversed is worse than not
    // answering — but the note stays findable for the record.
    note("notes", "old", decision("Fixed window", "superseded"));
    note("notes", "new", decision("Token bucket", "accepted", "- supersedes [[old]]\n"));
    expect(searchNotes(vault, {}).map((n) => n.slug)).toEqual(["new"]);
    expect(searchNotes(vault, { status: "superseded" }).map((n) => n.slug)).toEqual(["old"]);
    expect(searchNotes(vault, { all: true })).toHaveLength(2);
  });

  it("ranks a title hit above a body hit", () => {
    note("notes", "body", decision("Something else", "accepted", "mentions caching\n"));
    note("notes", "title", decision("Caching policy", "accepted"));
    expect(searchNotes(vault, { text: "caching" }).map((n) => n.slug)).toEqual(["title", "body"]);
  });

  it("finds where a session stopped, which lives in episodes/", () => {
    note("episodes", "s", "---\ntitle: Search rework\ntype: session\nstatus: open\n---\n# s\n");
    expect(searchNotes(vault, { type: "session", status: "open" }).map((n) => n.slug)).toEqual(["s"]);
  });

  it("searches the archive only when asked", () => {
    mkdirSync(join(vault, "memory", "archive"), { recursive: true });
    note("archive", "gone", decision("Archived call", "accepted"));
    expect(searchNotes(vault, { text: "archived" })).toEqual([]);
    expect(searchNotes(vault, { text: "archived", archive: true })).toHaveLength(1);
  });

  it("tells doctor when the store has outgrown a text scan", () => {
    for (let i = 0; i <= NOTES_INDEX_THRESHOLD; i += 1) note("notes", `n${i}`, decision(`N${i}`, "accepted"));
    expect(capFindings(vault).map((f) => f.cap)).toEqual(["notes search"]);
  }, 30_000); // writing 500+ files overruns the 5s default on the Windows CI runner
});

describe("the session brief", () => {
  const stats = { total_memories: 10, total_sessions: 3, last_session_at: Date.now() / 1000 };

  it("names the open decisions and leaves the settled ones out", () => {
    note("notes", "rate-limiting", OPEN_DECISION);
    note("notes", "storage", SETTLED_DECISION);

    const brief = buildBrief(vault, stats);
    expect(brief).toContain("Rate limiting");
    expect(brief).toContain("Token bucket over a fixed window");
    expect(brief).not.toContain("Storage engine");
  });

  it("names the live threads and what they were going to do next", () => {
    note(
      "episodes",
      "abc-session",
      `---
title: T-0001 セッション
type: session
status: open
task: T-0001
---
# T-0001 セッション
- [summary] got as far as the parser
- [next_step] wire it into the CLI
`,
    );
    const brief = buildBrief(vault, stats);
    expect(brief).toContain("T-0001");
    expect(brief).toContain("wire it into the CLI");
  });

  it("warns when capture has stopped, above the content", () => {
    // A reader who does not know the record stopped will trust what it says,
    // so the warning has to come before the thing being trusted.
    writeFileSync(
      join(vault, "capture-state.json"),
      JSON.stringify({ lastSuccessAt: null, consecutiveFailures: 3, lastError: "database is locked" }),
    );
    note("notes", "rate-limiting", OPEN_DECISION);

    const brief = buildBrief(vault, stats);
    expect(brief).toMatch(/連続失敗/);
    expect(brief.indexOf("連続失敗")).toBeLessThan(brief.indexOf("Rate limiting"));
  });

  it("still produces the time summary for a vault with no store", () => {
    const bare = mkdtempSync(join(os.tmpdir(), "workhub-bare-"));
    try {
      expect(buildBrief(bare, stats)).toContain("時間サマリー");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("the checkpoint", () => {
  const fields = {
    title: "T-0001 セッション",
    thread: "abc12345",
    task: "T-0001",
    summary: "parser works",
    next_step: ["wire it in"],
  };

  it("writes a note its own type accepts", () => {
    const { path, rewritten } = writeCheckpoint(vault, fields);
    expect(rewritten).toBe(false);
    const { findings } = validateNote(parseNote(readFileSync(path, "utf8")));
    expect(findings).toEqual([]);
  });

  it("rewrites the same note rather than adding a second one", () => {
    const first = writeCheckpoint(vault, fields);
    const second = writeCheckpoint(vault, { ...fields, summary: "parser and validator work" });

    expect(second.rewritten).toBe(true);
    expect(second.path).toBe(first.path);
    expect(readLayer(vault, "episodes")).toHaveLength(1);

    const text = readFileSync(second.path, "utf8");
    expect(text).toContain("parser and validator work");
    // The superseded summary is replaced in place, not appended below.
    expect(text).not.toContain("[summary] parser works");
  });

  it("keeps the prose a session wrote when the hook rewrites the note", () => {
    const { path } = writeCheckpoint(vault, { ...fields, body: "The real story, by hand." });
    writeCheckpoint(vault, { ...fields, summary: "later" });
    expect(readFileSync(path, "utf8")).toContain("The real story, by hand.");
  });

  it("drops a field it was not given instead of inventing one", () => {
    const text = renderCheckpoint({ title: "x", thread: "t", summary: "only this" });
    expect(text).toContain("[summary] only this");
    expect(text).not.toContain("[problem]");
    expect(text).not.toContain("[decision]");
  });
});

describe("extractTail", () => {
  it("takes what the owner said and leaves hook output out", () => {
    const transcript = join(vault, "session.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", message: { content: "first thing" } }),
        JSON.stringify({ type: "assistant", message: { content: "an answer" } }),
        JSON.stringify({ type: "user", message: { content: "<system-reminder>noise" } }),
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "second thing" }] },
        }),
        "{ torn",
      ].join("\n"),
    );

    expect(extractTail(transcript)).toEqual(["first thing", "second thing"]);
  });

  it("returns nothing for a transcript that is not there", () => {
    expect(extractTail(join(vault, "missing.jsonl"))).toEqual([]);
  });
});
