import { useEffect, useState } from "react";
import { Music } from "lucide-react";
import { api } from "@/lib/api";
import { toMusicData, useMusicStore } from "@/stores/music";
import type { Config } from "@/types";
import { AddUrlForm } from "./AddUrlForm";
import { PlayerPane } from "./PlayerPane";
import { PlaylistItems } from "./PlaylistItems";
import { PlaylistTabs } from "./PlaylistTabs";

const SAVE_DEBOUNCE_MS = 1000;

interface Props {
  /** Bumped by the app shell after settings are saved; triggers a config reload. */
  configVersion: number;
}

export function MusicView({ configVersion }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState("");
  const hydrated = useMusicStore((state) => state.hydrated);

  const vaultPath = config?.settings.vault_path ?? null;

  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  // ---- load persisted playlists once a vault is configured ----
  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    useMusicStore.setState({ hydrated: false });
    void api
      .loadMusicData(vaultPath)
      .then((data) => {
        if (!cancelled) useMusicStore.getState().hydrate(data);
      })
      .catch((e) => setStatus(`Failed to load music data — ${e}`));
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  // ---- persist changes back to the vault (debounced) ----
  useEffect(() => {
    if (!vaultPath) return;
    let timer: number | undefined;
    const unsubscribe = useMusicStore.subscribe((state, prev) => {
      // Skip until hydrated, and skip the hydration transition itself.
      if (!state.hydrated || !prev.hydrated) return;
      if (
        state.playlists === prev.playlists &&
        state.activePlaylistId === prev.activePlaylistId &&
        state.loopMode === prev.loopMode &&
        state.isShuffle === prev.isShuffle
      ) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void api
          .saveMusicData(vaultPath, toMusicData(useMusicStore.getState()))
          .then(() => setStatus(""))
          .catch((e) => setStatus(`Failed to save music data — ${e}`));
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [vaultPath]);

  if (config && !vaultPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Music className="size-8" />
        <p className="text-sm">No vault configured.</p>
        <p className="text-xs">
          Playlists are stored in the vault — set one up in the Tasks tab first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {status && <p className="text-xs text-destructive">{status}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <PlayerPane />
        {hydrated && (
          <div className="flex min-w-0 flex-col gap-3">
            <PlaylistTabs />
            <AddUrlForm />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PlaylistItems />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
