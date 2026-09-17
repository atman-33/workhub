// The hook payload Claude Code writes to stdin.
//
// A deliberate copy of the `readPayload` half of `plugins/workhub/hooks/lib.mjs`.
// Claude Code installs each plugin independently, into a cache keyed by that
// plugin's version, so one plugin cannot import from another's directory — a
// relative path out of this tree resolves in the repository and breaks on an
// installed copy. `hook-input.test.mjs` pins this against the original so the
// two cannot drift apart unnoticed.
import { readFileSync } from "node:fs";

/**
 * Parse the hook payload from stdin. Returns `{}` when stdin is empty or not
 * JSON — a hook must never fail because of its own input handling.
 */
export function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}
