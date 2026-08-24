import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import {
  fetchItemTitles,
  PLAYER_PLAYLIST_LIMIT,
  readPlaylistVideoIds,
  UNSUPPORTED_PLAYLIST_MESSAGE,
} from "@/lib/music/playlist-import";
import { loadYouTubeIframeApi } from "@/lib/music/youtube-iframe";
import { useMusicStore } from "@/stores/music";
import type { YouTubePlayerLike } from "@/stores/music/types";

const PLAYER_READY_TIMEOUT_MS = 15000;

/**
 * Creates an off-screen player used only to enumerate a playlist.
 *
 * A dedicated player rather than the visible one: cueing a playlist into the
 * player that is currently playing would stop the song (see
 * `.claude/rules/music-player.md`).
 */
const createImportPlayer = async () => {
  const YT = await loadYouTubeIframeApi();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const mount = document.createElement("div");
  host.appendChild(mount);
  document.body.appendChild(host);

  const dispose = (player: YouTubePlayerLike | null) => {
    player?.destroy?.();
    host.remove();
  };

  try {
    const player = await new Promise<YouTubePlayerLike>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error(UNSUPPORTED_PLAYLIST_MESSAGE)),
        PLAYER_READY_TIMEOUT_MS,
      );
      new YT.Player(mount, {
        events: {
          onReady: (event) => {
            window.clearTimeout(timer);
            resolve(event.target);
          },
          onStateChange: () => {},
        },
      });
    });
    return { player, dispose: () => dispose(player) };
  } catch (error) {
    dispose(null);
    throw error;
  }
};

export type PlaylistImportState =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "confirm"; newIds: string[]; duplicates: number; truncated: boolean }
  | { phase: "adding"; done: number; total: number }
  | { phase: "error"; message: string };

const toMessage = (error: unknown) =>
  error instanceof Error ? error.message : UNSUPPORTED_PLAYLIST_MESSAGE;

/** Drives the "paste a playlist URL" flow: read ids, confirm, then add. */
export const usePlaylistImport = (onDone: (added: number) => void) => {
  const [state, setState] = useState<PlaylistImportState>({ phase: "idle" });

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  const readPlaylist = useCallback(async (playlistId: string) => {
    setState({ phase: "reading" });
    let session: Awaited<ReturnType<typeof createImportPlayer>> | null = null;
    try {
      session = await createImportPlayer();
      const videoIds = await readPlaylistVideoIds(session.player, playlistId);
      const existing = new Set(
        useMusicStore.getState().getActivePlaylist()?.items.map((item) => item.id) ?? [],
      );
      const newIds = videoIds.filter((id) => !existing.has(id));
      setState({
        phase: "confirm",
        newIds,
        duplicates: videoIds.length - newIds.length,
        truncated: videoIds.length >= PLAYER_PLAYLIST_LIMIT,
      });
    } catch (error) {
      setState({ phase: "error", message: toMessage(error) });
    } finally {
      session?.dispose();
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (state.phase !== "confirm" || state.newIds.length === 0) {
      return;
    }
    const { newIds } = state;
    setState({ phase: "adding", done: 0, total: newIds.length });

    const items = await fetchItemTitles(newIds, {
      fetchTitle: (videoId) => api.fetchYoutubeTitle(videoId),
      onProgress: (done, total) => setState({ phase: "adding", done, total }),
    });

    const { added } = useMusicStore.getState().addManyToPlaylist(items);
    setState({ phase: "idle" });
    onDone(added);
  }, [state, onDone]);

  return { state, readPlaylist, confirmImport, reset };
};
