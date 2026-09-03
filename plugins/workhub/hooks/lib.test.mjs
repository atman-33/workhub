/**
 * The cwd gate on vault resolution, which is what lets this plugin be
 * installed at user scope (see `resolveVault` in `lib.mjs`).
 *
 * These hooks run in every session on the machine once the plugin is user
 * scope, so "the app has a vault configured" must not be enough on its own to
 * make them act — the session has to be inside that vault. The tests drive the
 * real module through `process.cwd` and `homedir`, because the bug this guards
 * against is precisely that the config is consulted when it should not be.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A directory tree with a vault at `<root>/vault` and a repo at `<root>/repo`. */
function fixture() {
  const root = mkdtempSync(join(os.tmpdir(), "workhub-vault-test-"));
  const vault = join(root, "vault");
  mkdirSync(join(vault, "tasks"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
  mkdirSync(join(vault, "projects", "foo"), { recursive: true });
  mkdirSync(join(root, "repo"), { recursive: true });
  // The config the app writes, in the home directory the module reads.
  const home = join(root, "home");
  mkdirSync(join(home, ".workhub"), { recursive: true });
  writeFileSync(
    join(home, ".workhub", "config.json"),
    JSON.stringify({ settings: { vault_path: vault } })
  );
  return { root, vault, home, repo: join(root, "repo") };
}

/**
 * Import a fresh copy of the module with `cwd` and the home directory pinned.
 *
 * The home directory is redirected through the environment rather than a spy
 * on `os.homedir`: `lib.mjs` imports that binding directly, and a spy on the
 * module namespace does not reach an already-bound named import. `os.homedir()`
 * reads `USERPROFILE` on Windows and `HOME` elsewhere, so stubbing both pins it
 * on either platform. It has to be `vi.stubEnv` rather than saving and
 * reassigning `process.env`: replacing that object wholesale swaps in a plain
 * JS object, and later writes to it never reach the real process environment
 * `os.homedir()` reads.
 */
async function load(cwd, home) {
  vi.resetModules();
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("HOME", home);
  return import("./lib.mjs");
}

describe("resolveVault", () => {
  let fx;

  beforeEach(() => {
    fx = fixture();
    vi.stubEnv("WORKHUB_VAULT", undefined);
    // APPDATA is the pre-0.49 config fallback; the real machine's would
    // resolve the real vault and mask the assertions below.
    vi.stubEnv("APPDATA", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("resolves the configured vault from the vault root", async () => {
    const { resolveVault } = await load(fx.vault, fx.home);
    expect(resolveVault()).toBe(fx.vault);
  });

  it("resolves it from a subdirectory of the vault", async () => {
    const { resolveVault } = await load(join(fx.vault, "projects", "foo"), fx.home);
    expect(resolveVault()).toBe(fx.vault);
  });

  it("returns null from an unrelated repository", async () => {
    const { resolveVault } = await load(fx.repo, fx.home);
    expect(resolveVault()).toBeNull();
  });

  it("honours WORKHUB_VAULT from anywhere", async () => {
    vi.stubEnv("WORKHUB_VAULT", fx.vault);
    const { resolveVault } = await load(fx.repo, fx.home);
    expect(resolveVault()).toBe(fx.vault);
  });

  it("recognises an unregistered vault from the cwd itself", async () => {
    const other = mkdtempSync(join(os.tmpdir(), "workhub-other-vault-"));
    mkdirSync(join(other, "tasks"));
    mkdirSync(join(other, "_ai"));
    const { resolveVault } = await load(other, fx.home);
    expect(resolveVault()).toBe(other);
  });

  it("returns null when no vault is configured", async () => {
    const emptyHome = join(fx.root, "empty-home");
    mkdirSync(emptyHome, { recursive: true });
    const { resolveVault } = await load(fx.repo, emptyHome);
    expect(resolveVault()).toBeNull();
  });
});
