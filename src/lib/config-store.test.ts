import { describe, expect, it } from "vitest";
import type { Config } from "@/types";
import { type ConfigApi, createConfigStore } from "./config-store";

function config(vault: string, extra: Record<string, unknown> = {}): Config {
  return {
    version: 1,
    projects: [],
    presets: [],
    selected: [],
    sort: "name",
    settings: { vault_path: vault, ...extra },
  } as unknown as Config;
}

/** A fake disk: reads and patches are held until the test releases them. */
function fakeApi(initial: Config) {
  let disk = initial;
  const gets: Array<(c: Config) => void> = [];
  const patches: Array<() => void> = [];
  const log: string[] = [];
  const api: ConfigApi = {
    getConfig: () => {
      log.push("get");
      return new Promise((resolve) => gets.push(resolve));
    },
    saveConfig: async (c) => {
      log.push("save");
      disk = c;
      return c;
    },
    patchSettings: (patch) => {
      log.push(`patch:${JSON.stringify(patch)}`);
      return new Promise((resolve) =>
        patches.push(() => {
          disk = { ...disk, settings: { ...disk.settings, ...patch } };
          resolve(disk);
        }),
      );
    },
  };
  return {
    api,
    log,
    setDisk: (c: Config) => {
      disk = c;
    },
    resolveGet: (i = 0) => gets[i](disk),
    resolvePatch: (i = 0) => patches[i](),
    getCount: () => gets.length,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createConfigStore", () => {
  it("holds nothing until the first load resolves", async () => {
    const f = fakeApi(config("/a"));
    const store = createConfigStore(f.api);
    expect(store.getSnapshot()).toBeNull();
    const p = store.load();
    f.resolveGet();
    expect((await p).settings.vault_path).toBe("/a");
    expect(store.getSnapshot()?.settings.vault_path).toBe("/a");
  });

  it("shares one request between concurrent loads", async () => {
    const f = fakeApi(config("/a"));
    const store = createConfigStore(f.api);
    const a = store.load();
    const b = store.load();
    expect(f.getCount()).toBe(1);
    f.resolveGet();
    expect(await a).toBe(await b);
  });

  it("starts a new request once the previous one has settled", async () => {
    const f = fakeApi(config("/a"));
    const store = createConfigStore(f.api);
    const first = store.load();
    f.resolveGet(0);
    await first;
    f.setDisk(config("/b"));
    const second = store.load();
    f.resolveGet(1);
    expect((await second).settings.vault_path).toBe("/b");
  });

  it("notifies subscribers when the held copy changes, and not after unsubscribe", async () => {
    const f = fakeApi(config("/a"));
    const store = createConfigStore(f.api);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    const p = store.load();
    f.resolveGet();
    await p;
    expect(calls).toBe(1);
    off();
    await store.saveConfig(config("/b"));
    expect(calls).toBe(1);
  });

  it("holds the result of a write, which may differ from what was sent", async () => {
    const f = fakeApi(config("/a"));
    // The new vault's own settings are adopted (T-0206).
    f.api.saveConfig = async () => config("/adopted");
    const store = createConfigStore(f.api);
    await store.saveConfig(config("/typed"));
    expect(store.getSnapshot()?.settings.vault_path).toBe("/adopted");
  });

  it("patches through the api's fresh-read path, not the held copy", async () => {
    const f = fakeApi(config("/a"));
    const store = createConfigStore(f.api);
    const l = store.load();
    f.resolveGet();
    await l;
    f.setDisk(config("/a", { terminal_embed: true })); // another writer
    const p = store.patchSettings({ vault_path: "/b" });
    await tick();
    f.resolvePatch();
    const saved = await p;
    expect(saved.settings).toMatchObject({ vault_path: "/b", terminal_embed: true });
    expect(store.getSnapshot()).toBe(saved);
  });

  it("runs writes one at a time, in order", async () => {
    const f = fakeApi(config("/a"));
    const store = createConfigStore(f.api);
    const p1 = store.patchSettings({ vault_path: "/1" });
    const p2 = store.patchSettings({ vault_path: "/2" });
    await tick();
    expect(f.log).toEqual(['patch:{"vault_path":"/1"}']); // the second has not started
    f.resolvePatch(0);
    await p1;
    await tick();
    expect(f.log).toHaveLength(2);
    f.resolvePatch(1);
    await p2;
    expect(store.getSnapshot()?.settings.vault_path).toBe("/2");
  });

  it("does not let a failed write block the next one", async () => {
    const f = fakeApi(config("/a"));
    const original = f.api.saveConfig;
    f.api.saveConfig = async () => {
      throw new Error("disk full");
    };
    const store = createConfigStore(f.api);
    await expect(store.saveConfig(config("/x"))).rejects.toThrow("disk full");
    f.api.saveConfig = original;
    await store.saveConfig(config("/y"));
    expect(store.getSnapshot()?.settings.vault_path).toBe("/y");
  });

  it("drops a read that was in flight when a write started", async () => {
    const f = fakeApi(config("/old"));
    const store = createConfigStore(f.api);
    const stale = store.load();
    await store.saveConfig(config("/new"));
    f.resolveGet(0);
    await stale;
    expect(store.getSnapshot()?.settings.vault_path).toBe("/new");
  });

  it("starts a fresh read after a write rather than joining one begun before it", async () => {
    const f = fakeApi(config("/old"));
    const store = createConfigStore(f.api);
    void store.load();
    await store.saveConfig(config("/new"));
    void store.load();
    expect(f.getCount()).toBe(2);
  });

  it("leaves the store usable after a rejected load", async () => {
    let fail = true;
    const api: ConfigApi = {
      getConfig: async () => {
        if (fail) throw new Error("boom");
        return config("/ok");
      },
      saveConfig: async (c) => c,
      patchSettings: async () => config("/ok"),
    };
    const store = createConfigStore(api);
    await expect(store.load()).rejects.toThrow("boom");
    fail = false;
    expect((await store.load()).settings.vault_path).toBe("/ok");
  });
});
