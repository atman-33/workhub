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
import { archiveNote, capFindings, hasStore, query, readLayer } from "./lib/store.mjs";

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
