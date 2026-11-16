import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { createConfigStore } from "@/lib/config-store";
import type { Config } from "@/types";

/** The app's one Config store (T-1223). */
export const configStore = createConfigStore(api);

/**
 * The held Config: `null` until the first read resolves. Mounting loads it
 * once; every view sharing the store sees a write as soon as it lands.
 */
export function useConfig(): Config | null {
  useEffect(() => {
    void configStore.load().catch(() => {});
  }, []);
  return useSyncExternalStore(configStore.subscribe, configStore.getSnapshot);
}
