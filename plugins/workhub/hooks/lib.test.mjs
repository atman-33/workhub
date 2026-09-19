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

/** Writes `<vault>/.workhub/settings.json` with the given `settings` object. */
function writeVaultSettings(vault, settings) {
  mkdirSync(join(vault, ".workhub"), { recursive: true });
  writeFileSync(
    join(vault, ".workhub", "settings.json"),
    JSON.stringify({ version: 1, settings })
  );
}

/**
 * `resolveResponseLanguage` (T-0388): the response-language reminder's
 * settings precedence. Deliberately **not** gated on cwd being inside the
 * vault, unlike `resolveVault` above — every test here runs from `fx.repo`,
 * an unrelated directory, to prove the reminder still resolves there.
 */
describe("resolveResponseLanguage", () => {
  let fx;

  beforeEach(() => {
    fx = fixture();
    vi.stubEnv("WORKHUB_VAULT", undefined);
    vi.stubEnv("APPDATA", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reads language from the vault's settings.json, from any cwd", async () => {
    writeVaultSettings(fx.vault, { language: "ja" });
    const { resolveResponseLanguage } = await load(fx.repo, fx.home);
    expect(resolveResponseLanguage()).toEqual({ language: "ja", inject: true });
  });

  it("falls back to the old task_language key in the vault's settings.json", async () => {
    writeVaultSettings(fx.vault, { task_language: "ja" });
    const { resolveResponseLanguage } = await load(fx.repo, fx.home);
    expect(resolveResponseLanguage()).toEqual({ language: "ja", inject: true });
  });

  it("falls back to the old task_language key in the app config when there is no vault file", async () => {
    mkdirSync(join(fx.home, ".workhub"), { recursive: true });
    writeFileSync(
      join(fx.home, ".workhub", "config.json"),
      JSON.stringify({ settings: { vault_path: fx.vault, task_language: "ja" } })
    );
    const { resolveResponseLanguage } = await load(fx.repo, fx.home);
    expect(resolveResponseLanguage()).toEqual({ language: "ja", inject: true });
  });

  it("uses the app config's language when no vault is configured", async () => {
    mkdirSync(join(fx.home, ".workhub"), { recursive: true });
    writeFileSync(
      join(fx.home, ".workhub", "config.json"),
      JSON.stringify({ settings: { language: "ja" } })
    );
    const { resolveResponseLanguage } = await load(fx.repo, fx.home);
    expect(resolveResponseLanguage()).toEqual({ language: "ja", inject: true });
  });

  it("suppresses injection when response_language_inject is false at the level that supplied the language", async () => {
    writeVaultSettings(fx.vault, { language: "ja", response_language_inject: false });
    const { resolveResponseLanguage } = await load(fx.repo, fx.home);
    expect(resolveResponseLanguage()).toEqual({ language: "ja", inject: false });
  });

  it("returns null when nothing is configured", async () => {
    const emptyHome = join(fx.root, "empty-home");
    mkdirSync(emptyHome, { recursive: true });
    const { resolveResponseLanguage } = await load(fx.repo, emptyHome);
    expect(resolveResponseLanguage()).toBeNull();
  });

  it("honours WORKHUB_VAULT over the app config's vault_path", async () => {
    const other = mkdtempSync(join(os.tmpdir(), "workhub-other-vault-"));
    writeVaultSettings(other, { language: "en" });
    writeVaultSettings(fx.vault, { language: "ja" });
    vi.stubEnv("WORKHUB_VAULT", other);
    const { resolveResponseLanguage } = await load(fx.repo, fx.home);
    expect(resolveResponseLanguage()).toEqual({ language: "en", inject: true });
  });
});

describe("languageName", () => {
  it("maps known codes to their display name", async () => {
    const { languageName } = await import("./lib.mjs");
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("en")).toBe("English");
  });

  it("uses an unrecognized code verbatim rather than skipping it", async () => {
    const { languageName } = await import("./lib.mjs");
    expect(languageName("fr")).toBe("fr");
  });
});

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

/**
 * The policy and the log are two files, not one section of one file: the policy
 * is read in full on every question and the log is only ever grepped, so a
 * resolver that pointed both at the same note would put the unbounded half back
 * into every session's context (T-0242).
 */
describe("profile paths", () => {
  let fx;

  beforeEach(() => {
    fx = fixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("separates the always-loaded policy from the searched notes", async () => {
    // Two layers of `memory/`, not one folder with two kinds of file in it:
    // the policy is read in full on every question, the notes are searched.
    const { resolveDecisionPolicy, resolveNotesDir } = await load(fx.vault, fx.home);
    expect(resolveDecisionPolicy(fx.vault)).toBe(
      join(fx.vault, "memory", "identity", "decision-policy.md")
    );
    expect(resolveNotesDir(fx.vault)).toBe(join(fx.vault, "memory", "notes"));
  });
});
