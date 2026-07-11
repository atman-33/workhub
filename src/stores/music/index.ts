import { create } from "zustand";
import { enforcePlaylistBounds, sanitizePlaylistIdentifiers } from "@/lib/music/playlist-helpers";
import { rebuildShuffleQueues } from "@/lib/music/shuffle-queue";
import type { MusicData } from "@/lib/music/types";
import { createPlaybackSlice } from "./playback-slice";
import { createPlaylistSlice, defaultActivePlaylistId, defaultPlaylists } from "./playlist-slice";
import type { MusicState, PersistenceSlice } from "./types";

const createPersistenceSlice = (
  set: (partial: Partial<MusicState>) => void,
): PersistenceSlice => ({
  hydrated: false,
  hydrate: (data) => {
    if (!data || data.playlists.length === 0) {
      set({
        playlists: defaultPlaylists,
        activePlaylistId: defaultActivePlaylistId,
        canCreatePlaylist: true,
        loopMode: "all",
        isShuffle: false,
        currentVideoId: null,
        currentIndex: null,
        isPlaying: false,
        shuffleQueue: {},
        hydrated: true,
      });
      return;
    }

    // The JSON may have been hand-edited in the vault; sanitize before use.
    const sanitized = sanitizePlaylistIdentifiers(data.playlists, data.active_playlist_id);
    const constrained = enforcePlaylistBounds(sanitized.playlists, sanitized.activePlaylistId);
    const activePlaylist = constrained.playlists.find(
      (playlist) => playlist.id === constrained.activePlaylistId,
    );
    const firstVideo = activePlaylist?.items[0];
    const isShuffle = Boolean(data.is_shuffle);

    set({
      ...constrained,
      loopMode: data.loop_mode === "one" ? "one" : "all",
      isShuffle,
      currentVideoId: firstVideo?.id ?? null,
      currentIndex: firstVideo ? 0 : null,
      isPlaying: false,
      shuffleQueue: isShuffle
        ? rebuildShuffleQueues(
            {},
            constrained.playlists,
            constrained.activePlaylistId,
            firstVideo?.id ?? null,
          )
        : {},
      hydrated: true,
    });
  },
});

export const useMusicStore = create<MusicState>()((set, get, store) => ({
  ...createPlaylistSlice(set, get, store),
  ...createPlaybackSlice(set, get, store),
  ...createPersistenceSlice(set),
}));

/** Projects the store onto the wire format persisted in the vault. */
export const toMusicData = (state: MusicState): MusicData => ({
  playlists: state.playlists,
  active_playlist_id: state.activePlaylistId,
  loop_mode: state.loopMode,
  is_shuffle: state.isShuffle,
});
