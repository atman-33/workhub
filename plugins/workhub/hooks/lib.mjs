import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Resolve the workhub vault path: WORKHUB_VAULT env var, then config.json. */
export function resolveVault() {
  if (process.env.WORKHUB_VAULT) return process.env.WORKHUB_VAULT;
  const appdata = process.env.APPDATA;
  if (!appdata) return null;
  try {
    const cfg = JSON.parse(readFileSync(join(appdata, "workhub", "config.json"), "utf8"));
    return cfg.vault_path ?? null;
  } catch {
    return null;
  }
}

/** Read the hook payload from stdin as JSON. */
export function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}
