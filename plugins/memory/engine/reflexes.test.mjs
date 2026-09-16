/**
 * The reflex layer (T-0370) — the part that gets the record read.
 *
 * What matters here is not the wording but three properties: it says nothing
 * when there is nothing to say, the per-turn cost stays one line, and the
 * things a session most often gets wrong are actually named.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBrief } from "./lib/brief.mjs";
import { WRITING_NOTE, reflexReminder, reflexes } from "./lib/reflexes.mjs";

let vault;
let previousHome;

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "workhub-reflex-"));
  previousHome = process.env.WORKHUB_ENGINE_HOME;
  process.env.WORKHUB_ENGINE_HOME = vault;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.WORKHUB_ENGINE_HOME;
  else process.env.WORKHUB_ENGINE_HOME = previousHome;
  rmSync(vault, { recursive: true, force: true });
});

function giveItAStore() {
  for (const layer of ["identity", "knowledge", "howto", "episodes"]) {
    mkdirSync(join(vault, "memory", layer), { recursive: true });
  }
}

describe("reflexes", () => {
  it("says nothing when there is no store to reflect against", () => {
    // Advice about searching a folder that is not there is noise, and noise in
    // an opening block is how a session learns to skim it.
    expect(reflexes({ hasStore: false })).toBe("");
    expect(reflexReminder({ hasStore: false })).toBe("");
  });

  it("names the four things a session actually gets wrong", () => {
    const text = reflexes({ hasStore: true });
    expect(text).toMatch(/答える前に引く/); // answering from context instead of the record
    expect(text).toMatch(/type: decision/); // writing an untyped, unfindable note
    expect(text).toMatch(/出典/); // paraphrasing instead of citing
    expect(text).toMatch(/矛盾|食い違/); // silently picking a side
  });

  it("forbids recording a test as passed when it did not run", () => {
    // One false entry costs the layer its credibility, and a memory nobody
    // trusts is worse than no memory.
    expect(reflexes({ hasStore: true })).toMatch(/実行していないテスト/);
  });

  it("points at the owner's writing standard only once they have one", () => {
    expect(reflexes({ hasStore: true, hasWritingNote: false })).not.toContain(WRITING_NOTE);
    expect(reflexes({ hasStore: true, hasWritingNote: true })).toContain(WRITING_NOTE);
  });

  it("keeps the per-turn reminder to a single line", () => {
    // It is paid for on every prompt of every session; the full text is in the
    // brief, which is paid for once.
    const line = reflexReminder({ hasStore: true });
    expect(line.split("\n")).toHaveLength(1);
    expect(line.length).toBeLessThan(120);
  });
});

describe("the brief", () => {
  const stats = { total_memories: 1, total_sessions: 1, last_session_at: Date.now() / 1000 };

  it("carries the reflexes once a vault has a store", () => {
    giveItAStore();
    expect(buildBrief(vault, stats)).toMatch(/記憶の使い方/);
  });

  it("leaves them out of a vault that has none", () => {
    expect(buildBrief(vault, stats)).not.toMatch(/記憶の使い方/);
  });

  it("puts what the session needs first, and how to use it last", () => {
    giveItAStore();
    writeFileSync(
      join(vault, "memory", "knowledge", "d.md"),
      "---\ntitle: Rate limiting\ntype: decision\nstatus: open\n---\n# Rate limiting\n- [decision] token bucket\n",
    );
    const brief = buildBrief(vault, stats);
    expect(brief.indexOf("Rate limiting")).toBeLessThan(brief.indexOf("記憶の使い方"));
  });

  it("does not let the budget clip the reflexes off the end", () => {
    giveItAStore();
    // Five open decisions with long titles: the brief is at its widest here,
    // and the part that would be lost to a tight budget is the last block.
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(
        join(vault, "memory", "knowledge", `d${i}.md`),
        `---\ntitle: ${"decision ".repeat(20)}${i}\ntype: decision\nstatus: open\n---\n# d${i}\n- [decision] ${"x".repeat(200)}\n`,
      );
    }
    expect(buildBrief(vault, stats)).toMatch(/記憶の使い方/);
  });
});
