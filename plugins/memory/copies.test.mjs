/**
 * The memory plugin carries copies of two small pieces of the workhub plugin,
 * because Claude Code installs each plugin into a version-keyed cache and one
 * plugin cannot import from another's directory.
 *
 * A copy that drifts is worse than no copy: capture would read markers from a
 * path `task-cli` no longer writes to, and sessions would be filed under no
 * task at all — silently, which is the failure mode this whole item exists to
 * stop. So the copies are pinned against the originals here rather than left to
 * review, the same way the plugin catalog is pinned against the marketplace.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as copy from "./lib/session-marker-read.mjs";
import * as original from "../workhub/lib/session-marker.mjs";
import { readPayload as copiedReadPayload } from "./lib/hook-input.mjs";
import { readPayload as originalReadPayload } from "../workhub/hooks/lib.mjs";

const vault = join(dirname(fileURLToPath(import.meta.url)), "fixture-vault");

describe("session-marker-read", () => {
  it("derives the same key as the workhub plugin", () => {
    const previous = process.env.CLAUDE_CODE_SESSION_ID;
    try {
      for (const explicit of ["", "abc-123", "a/b\\c", "..", "  "]) {
        expect(copy.sessionKey(explicit), explicit).toBe(original.sessionKey(explicit));
      }
      process.env.CLAUDE_CODE_SESSION_ID = "env-session-id";
      expect(copy.sessionKey()).toBe(original.sessionKey());
      delete process.env.CLAUDE_CODE_SESSION_ID;
      expect(copy.sessionKey()).toBe(original.sessionKey());
      expect(copy.sessionKey()).toBe("default");
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = previous;
    }
  });

  it("resolves the same marker location as the workhub plugin", () => {
    expect(copy.sessionsDir(vault)).toBe(original.sessionsDir(vault));
    for (const key of ["default", "abc-123", "a/b"]) {
      expect(copy.markerPath(vault, key), key).toBe(original.markerPath(vault, key));
    }
  });

  it("returns null for a marker that is not there", () => {
    expect(copy.readMarker(vault, "nobody")).toBeNull();
    expect(copy.readMarker(vault, "nobody")).toEqual(original.readMarker(vault, "nobody"));
  });
});

describe("hook-input", () => {
  it("is the same function as the workhub plugin's readPayload", () => {
    // Behaviour cannot be compared without a stdin, and both read fd 0 — so
    // compare the source instead, which is what would actually drift.
    // Normalize line endings before comparing: the repository holds files in
    // both, and CRLF vs LF is not drift.
    const CR = String.fromCharCode(13);
    const source = (fn) => fn.toString().split(CR).join("");
    expect(source(copiedReadPayload)).toBe(source(originalReadPayload));
  });
});
