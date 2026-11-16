import { useEffect, useState } from "react";
import { Music } from "lucide-react";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/use-config";
import { t as tStatic, useT } from "@/lib/i18n";
import { isSearchShortcut } from "@/lib/music/search-shortcut";
import { toMusicData, useMusicStore } from "@/stores/music";
import { AddUrlForm } from "./add-url-form";
import { PlayerPane } from "./player-pane";
import { PlaylistItems } from "./playlist-items";
import { PlaylistTabs } from "./playlist-tabs";
import { TrackSearchDialog } from "./track-search-dialog";

const SAVE_DEBOUNCE_MS = 1000;

/** `active`: this is the visible tab. Tabs stay mounted while hidden, so the
 *  search shortcut must only react while Music is the one on screen. */
export function MusicView({ active }: { active: boolean }) {
  const t = useT();
  const config = useConfig();
  const [status, setStatus] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const hydrated = useMusicStore((state) => state.hydrated);

  const vaultPath = config?.settings.vault_path ?? null;

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
      .catch((e) => setStatus(tStatic("music.view.loadFailed", { error: String(e) })));
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
          .catch((e) => setStatus(tStatic("music.view.saveFailed", { error: String(e) })));
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [vaultPath]);

  // ---- Ctrl+F or "/" opens the track search while this tab is on screen ----
  useEffect(() => {
    if (!active || !vaultPath) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      // Keep the WebView's own find bar (Ctrl+F) and a typed "/" out of it.
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, vaultPath]);

  if (config && !vaultPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Music className="size-8" />
        <p className="text-sm">{t("music.view.noVault")}</p>
        <p className="text-xs">{t("music.view.noVaultHint")}</p>
      </div>
    );
  }

  return (
    // Two-column layout keeps the page itself fixed and scrolls the track list
    // on its own; the stacked one-column layout has no height to share, so it
    // falls back to scrolling the whole page.
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 lg:overflow-hidden">
      {status && <p className="text-xs text-destructive">{status}</p>}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto">
          <PlayerPane />
        </div>
        {hydrated && (
          <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
            <PlaylistTabs onOpenSearch={() => setSearchOpen(true)} />
            <AddUrlForm />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PlaylistItems />
            </div>
          </div>
        )}
      </div>
      <TrackSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
