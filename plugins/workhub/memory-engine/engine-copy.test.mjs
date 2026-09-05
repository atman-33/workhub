/**
 * The installed engine copy has to be self-contained.
 *
 * `setup` copies `memory-engine/cli.mjs` and `memory-engine/lib/` to
 * `~/.workhub/memory-engine/engine/`, plus the plugin's own `lib/` one level
 * above it, so that callers outside the Claude plugin cache (the OpenCode
 * plugin, a plain terminal) do not depend on the versioned plugin directory.
 *
 * An import in `cli.mjs` that points at a file the copy does not carry
 * resolves fine in the repository and throws on load in the copy — the
 * failure appears only on a machine that has run `memory-setup`, which is
 * nowhere near the change that caused it. So the copy is rebuilt here and its
 * imports are resolved against it.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const engineDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = dirname(engineDir);

/** Mirror `installEngineCopy`, into a temporary engine home. */
function installCopy() {
  const home = mkdtempSync(join(os.tmpdir(), "workhub-engine-"));
  const installed = join(home, "engine");
  mkdirSync(installed, { recursive: true });
  cpSync(join(engineDir, "cli.mjs"), join(installed, "cli.mjs"));
  cpSync(join(engineDir, "lib"), join(installed, "lib"), { recursive: true });
  cpSync(join(pluginDir, "lib"), join(home, "lib"), { recursive: true });
  return installed;
}

/** Every relative specifier `file` imports. */
function relativeImports(file) {
  const source = readFileSync(file, "utf8");
  const found = new Set();
  for (const m of source.matchAll(/from\s+"(\.[^"]+)"/g)) found.add(m[1]);
  for (const m of source.matchAll(/import\(\s*"(\.[^"]+)"\s*\)/g)) found.add(m[1]);
  return [...found];
}

describe("installed engine copy", () => {
  it("carries every file cli.mjs imports", () => {
    const installed = installCopy();
    const cli = join(installed, "cli.mjs");
    const missing = relativeImports(cli).filter((spec) => !existsSync(resolve(dirname(cli), spec)));
    expect(missing).toEqual([]);
  });

  // The one that reaches outside `engine/` — pinned by name, because the
  // relative depth is what makes it fragile.
  it("places the shared plugin lib beside the engine, not inside it", () => {
    const installed = installCopy();
    expect(existsSync(join(installed, "..", "lib", "session-marker.mjs"))).toBe(true);
  });
});
