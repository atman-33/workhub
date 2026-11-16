import {
  drawFromShuffleQueue,
  resetQueueForPlaylist,
  sanitizeShuffleQueue,
  withQueueForPlaylist,
} from "@/lib/music/shuffle-queue";
import type { MusicStoreSlice, PlaybackSlice } from "./types";

const MAX_PLAY_HISTORY = 100;

/** Appends the track being left to the playlist's history (capped, newest last). */
const pushHistory = (
  history: Record<string, string[]>,
  playlistId: string,
  leavingId: string | null,
  nextId: string,
) => {
  if (!leavingId || leavingId === nextId) {
    return history;
  }
  const list = [...(history[playlistId] ?? []), leavingId].slice(-MAX_PLAY_HISTORY);
  return { ...history, [playlistId]: list };
};

export const createPlaybackSlice: MusicStoreSlice<PlaybackSlice> = (set, get) => ({
  isPlaying: false,
  currentVideoId: null,
  currentIndex: null,
  loopMode: "all",
  isShuffle: false,
  shuffleQueue: {},
  playHistory: {},
  playerInstance: null,
  setPlayerInstance: (player) => set({ playerInstance: player }),
  play: (videoId) => {
    const { playerInstance } = get();
    const activePlaylist = get().getActivePlaylist();
    if (playerInstance) {
      playerInstance.loadVideoById(videoId);
      playerInstance.playVideo();
    }

    const newIndex = activePlaylist?.items.findIndex((item) => item.id === videoId) ?? -1;

    set((state) => {
      if (!state.isShuffle || !activePlaylist) {
        return {
          isPlaying: true,
          currentVideoId: videoId,
          currentIndex: newIndex >= 0 ? newIndex : null,
        };
      }

      const queue = sanitizeShuffleQueue(
        state.shuffleQueue[activePlaylist.id],
        activePlaylist,
        videoId,
      );

      return {
        isPlaying: true,
        currentVideoId: videoId,
        currentIndex: newIndex >= 0 ? newIndex : null,
        shuffleQueue: withQueueForPlaylist(state.shuffleQueue, activePlaylist.id, queue),
        playHistory: pushHistory(
          state.playHistory,
          activePlaylist.id,
          state.currentVideoId,
          videoId,
        ),
      };
    });
  },
  playTrackInPlaylist: (playlistId, videoId) => {
    const state = get();
    const target = state.playlists.find((playlist) => playlist.id === playlistId);
    if (!target || !target.items.some((item) => item.id === videoId)) {
      return;
    }
    if (playlistId === state.activePlaylistId) {
      state.play(videoId);
      return;
    }
    // Switch playlists without going through its first track (what
    // setActivePlaylist would play), and clear the current track so play()
    // does not push a track of the old playlist into the new one's history.
    // Starting from a search result is a fresh start, so the shuffle queue
    // and history of the new playlist begin empty.
    set({
      activePlaylistId: playlistId,
      currentVideoId: null,
      currentIndex: null,
      shuffleQueue: state.isShuffle
        ? resetQueueForPlaylist(state.shuffleQueue, playlistId)
        : state.shuffleQueue,
      playHistory: { ...state.playHistory, [playlistId]: [] },
    });
    get().play(videoId);
  },
  pause: () => {
    const { playerInstance } = get();
    if (playerInstance) {
      playerInstance.pauseVideo();
    }
    set({ isPlaying: false });
  },
  setPlayingStateToFalse: () => {
    set({ isPlaying: false });
  },
  resume: () => {
    const { playerInstance } = get();
    if (playerInstance) {
      playerInstance.playVideo();
    }
    set({ isPlaying: true });
  },
  toggleLoop: () =>
    set((state) => ({
      loopMode: state.loopMode === "all" ? "one" : "all",
    })),
  toggleShuffle: () =>
    set((state) => {
      const isShuffleEnabled = !state.isShuffle;
      if (!isShuffleEnabled) {
        return { isShuffle: isShuffleEnabled, shuffleQueue: {}, playHistory: {} };
      }

      const activePlaylist = state.playlists.find(
        (playlist) => playlist.id === state.activePlaylistId,
      );
      if (!activePlaylist) {
        return { isShuffle: isShuffleEnabled, shuffleQueue: {} };
      }

      const queue = sanitizeShuffleQueue(
        state.shuffleQueue[activePlaylist.id],
        activePlaylist,
        state.currentVideoId,
      );

      return {
        isShuffle: isShuffleEnabled,
        shuffleQueue: withQueueForPlaylist(state.shuffleQueue, activePlaylist.id, queue),
      };
    }),
  playNext: () => {
    const activePlaylist = get().getActivePlaylist();
    const {
      currentIndex,
      loopMode,
      isShuffle,
      playerInstance,
      shuffleQueue,
      currentVideoId,
      playHistory,
    } = get();

    if (!activePlaylist || activePlaylist.items.length === 0) {
      set({ isPlaying: false });
      return;
    }

    if (isShuffle) {
      const { nextId, queue } = drawFromShuffleQueue(
        shuffleQueue[activePlaylist.id],
        activePlaylist,
        currentVideoId,
      );
      const videoId = nextId ?? activePlaylist.items[0]?.id;
      if (!videoId) {
        set({ isPlaying: false });
        return;
      }
      if (playerInstance) {
        playerInstance.loadVideoById(videoId);
        playerInstance.playVideo();
      }
      const nextShuffleIndex = activePlaylist.items.findIndex((item) => item.id === videoId);
      set({
        currentIndex: nextShuffleIndex >= 0 ? nextShuffleIndex : null,
        currentVideoId: videoId,
        isPlaying: true,
        shuffleQueue: withQueueForPlaylist(shuffleQueue, activePlaylist.id, queue),
        playHistory: pushHistory(playHistory, activePlaylist.id, currentVideoId, videoId),
      });
      return;
    }

    const nextIndex = (currentIndex ?? -1) + 1;
    if (nextIndex >= activePlaylist.items.length) {
      if (loopMode === "all") {
        const videoId = activePlaylist.items[0].id;
        if (playerInstance) {
          playerInstance.loadVideoById(videoId);
          playerInstance.playVideo();
        }
        set({ currentIndex: 0, currentVideoId: videoId, isPlaying: true });
      } else {
        set({ isPlaying: false });
      }
    } else {
      const videoId = activePlaylist.items[nextIndex].id;
      if (playerInstance) {
        playerInstance.loadVideoById(videoId);
        playerInstance.playVideo();
      }
      set({ currentIndex: nextIndex, currentVideoId: videoId, isPlaying: true });
    }
  },
  playPrevious: () => {
    const activePlaylist = get().getActivePlaylist();
    const { currentIndex, loopMode, isShuffle, playerInstance, currentVideoId, playHistory } =
      get();

    if (!activePlaylist || activePlaylist.items.length === 0) {
      return;
    }

    if (isShuffle) {
      // Go back to what actually played, skipping tracks removed since.
      const ids = new Set(activePlaylist.items.map((item) => item.id));
      const history = [...(playHistory[activePlaylist.id] ?? [])];
      let videoId: string | undefined;
      while (history.length > 0) {
        const candidate = history.pop();
        if (candidate && ids.has(candidate)) {
          videoId = candidate;
          break;
        }
      }
      // Nothing to go back to: restart the current track.
      videoId ??= currentVideoId ?? undefined;
      if (!videoId) {
        return;
      }
      if (playerInstance) {
        playerInstance.loadVideoById(videoId);
        playerInstance.playVideo();
      }
      const previousShuffleIndex = activePlaylist.items.findIndex((item) => item.id === videoId);
      set({
        currentIndex: previousShuffleIndex >= 0 ? previousShuffleIndex : null,
        currentVideoId: videoId,
        isPlaying: true,
        playHistory: { ...playHistory, [activePlaylist.id]: history },
      });
      return;
    }

    const prevIndex = (currentIndex ?? 0) - 1;
    if (prevIndex < 0) {
      if (loopMode === "all") {
        const lastIndex = activePlaylist.items.length - 1;
        const videoId = activePlaylist.items[lastIndex].id;
        if (playerInstance) {
          playerInstance.loadVideoById(videoId);
          playerInstance.playVideo();
        }
        set({ currentIndex: lastIndex, currentVideoId: videoId, isPlaying: true });
      } else {
        set({ isPlaying: false });
      }
    } else {
      const videoId = activePlaylist.items[prevIndex].id;
      if (playerInstance) {
        playerInstance.loadVideoById(videoId);
        playerInstance.playVideo();
      }
      set({ currentIndex: prevIndex, currentVideoId: videoId, isPlaying: true });
    }
  },
});
