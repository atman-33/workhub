import type { Config, Settings } from "@/types";

/**
 * The Config store (T-1223): the app's one in-memory copy of `config.json`,
 * with the loading and writing rules every view used to repeat. React-free,
 * so it can be tested with a fake api; `use-config.ts` binds it to a view.
 *
 * The file on disk is the source of truth and has several writers (Settings
 * dialog, the Voice / Ink / Clips / Inbox tabs, another window). The store is a
 * cache of it, not a replacement:
 *
 * - **Writes read fresh first.** `patchSettings` goes through the api's
 *   fresh-read merge (T-0281), never the cached copy, so a stale cache cannot
 *   revert what another writer saved meanwhile.
 * - **One write at a time.** Writes are queued, so two quick patches cannot
 *   interleave their read-merge-write and drop one.
 * - **Reads are deduplicated.** Concurrent `load`s share one request. A read
 *   that was already in flight when a write began is discarded rather than
 *   allowed to overwrite the newer copy.
 * - **A write adopts its result.** `saveConfig` returns the config that took
 *   effect, which differs from what was sent when the vault changed and its own
 *   settings were adopted (T-0206); that result becomes the copy everyone sees.
 */

/** The config port: the three commands the store needs. */
export interface ConfigApi {
  getConfig(): Promise<Config>;
  /** Resolves to the config that took effect. */
  saveConfig(config: Config): Promise<Config>;
  /** Merges `patch` into a fresh read of the settings and saves; resolves to the config that took effect. */
  patchSettings(patch: Partial<Settings>): Promise<Config>;
}

export interface ConfigStore {
  /** The held copy; `null` until the first load or write resolves. */
  getSnapshot(): Config | null;
  /** Subscribes to changes of the held copy; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Reads the config from disk and holds it. Concurrent calls share one request. */
  load(): Promise<Config>;
  /**
   * Saves a few settings onto a fresh read of the config. With `optimistic`,
   * the held copy shows the patch at once, for a control that must not wait on
   * the disk; if the write fails the store re-reads the disk, so it never keeps
   * showing what was not saved.
   */
  patchSettings(patch: Partial<Settings>, options?: { optimistic?: boolean }): Promise<Config>;
  /** Saves a whole config; holds what took effect. */
  saveConfig(config: Config): Promise<Config>;
}

export function createConfigStore(api: ConfigApi): ConfigStore {
  let current: Config | null = null;
  const listeners = new Set<() => void>();
  // Bumped when a write starts and again when it ends: a read that began
  // before either must not land on top of the write's result.
  let generation = 0;
  let inflight: { promise: Promise<Config>; generation: number } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const hold = (next: Config) => {
    current = next;
    for (const listener of [...listeners]) listener();
  };

  const load = (): Promise<Config> => {
    if (inflight && inflight.generation === generation) return inflight.promise;
    const startedAt = generation;
    const promise = api
      .getConfig()
      .then((cfg) => {
        // A write overtook this read; its result is newer.
        if (generation !== startedAt && current) return current;
        hold(cfg);
        return cfg;
      })
      .finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });
    inflight = { promise, generation: startedAt };
    return promise;
  };

  const write = (run: () => Promise<Config>): Promise<Config> => {
    generation++;
    const result = queue.then(async () => {
      const saved = await run();
      generation++;
      hold(saved);
      return saved;
    });
    // A failed write must not block the ones queued behind it.
    queue = result.catch(() => {});
    return result;
  };

  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    load,
    patchSettings(patch, options) {
      const result = write(() => api.patchSettings(patch));
      if (options?.optimistic) {
        if (current) hold({ ...current, settings: { ...current.settings, ...patch } });
        // Resync rather than keep a value the disk never took.
        result.catch(() => void load().catch(() => {}));
      }
      return result;
    },
    saveConfig: (config) => write(() => api.saveConfig(config)),
  };
}
