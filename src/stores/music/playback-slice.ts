import {
  drawFromShuffleQueue,
  sanitizeShuffleQueue,
  withQueueForPlaylist,
} from "@/lib/music/shuffle-queue";
import type { MusicStoreSlice, PlaybackSlice } from "./types";

export const createPlaybackSlice: MusicStoreSlice<PlaybackSlice> = (set, get) => ({
  isPlaying: false,
  currentVideoId: null,
  currentIndex: null,
  loopMode: "all",
  isShuffle: false,
  shuffleQueue: {},
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
      };
    });
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
        return { isShuffle: isShuffleEnabled, shuffleQueue: {} };
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
    const { currentIndex, loopMode, isShuffle, playerInstance, shuffleQueue, currentVideoId } =
      get();

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
    const { currentIndex, loopMode, isShuffle, playerInstance, shuffleQueue, currentVideoId } =
      get();

    if (!activePlaylist || activePlaylist.items.length === 0) {
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
      const previousShuffleIndex = activePlaylist.items.findIndex((item) => item.id === videoId);
      set({
        currentIndex: previousShuffleIndex >= 0 ? previousShuffleIndex : null,
        currentVideoId: videoId,
        isPlaying: true,
        shuffleQueue: withQueueForPlaylist(shuffleQueue, activePlaylist.id, queue),
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
