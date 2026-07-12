import {
  deriveNextPlaylistName,
  enforcePlaylistBounds,
  generatePlaylistId,
  MAX_PLAYLIST_COUNT,
} from "@/lib/music/playlist-helpers";
import { removeQueueForPlaylist, resetQueueForPlaylist } from "@/lib/music/shuffle-queue";
import type { Playlist } from "@/lib/music/types";
import type { MusicStoreSlice, PlaylistSlice } from "./types";

export const defaultPlaylists: Playlist[] = [
  { id: "playlist-default-1", name: "Playlist 1", items: [] },
];

export const defaultActivePlaylistId = defaultPlaylists[0].id;

export const createPlaylistSlice: MusicStoreSlice<PlaylistSlice> = (set, get) => ({
  playlists: defaultPlaylists,
  maxPlaylistCount: MAX_PLAYLIST_COUNT,
  canCreatePlaylist: defaultPlaylists.length < MAX_PLAYLIST_COUNT,
  activePlaylistId: defaultActivePlaylistId,
  addToPlaylist: (item, playlistId) => {
    const state = get();
    const targetPlaylistId = playlistId || state.activePlaylistId;
    const targetPlaylist = state.playlists.find((playlist) => playlist.id === targetPlaylistId);

    if (targetPlaylist?.items.some((existingItem) => existingItem.id === item.id)) {
      return false;
    }

    set((currentState) => {
      const updatedPlaylists = currentState.playlists.map((playlist) =>
        playlist.id === targetPlaylistId
          ? { ...playlist, items: [...playlist.items, item] }
          : playlist,
      );
      const shouldResetShuffle =
        currentState.isShuffle && targetPlaylistId === currentState.activePlaylistId;
      return {
        playlists: updatedPlaylists,
        currentIndex: currentState.currentIndex === null ? 0 : currentState.currentIndex,
        shuffleQueue: shouldResetShuffle
          ? resetQueueForPlaylist(currentState.shuffleQueue, targetPlaylistId)
          : currentState.shuffleQueue,
      };
    });

    return true;
  },
  removeFromPlaylist: (index, playlistId) => {
    const state = get();
    const targetPlaylistId = playlistId || state.activePlaylistId;

    set((currentState) => {
      const updatedPlaylists = currentState.playlists.map((playlist) => {
        if (playlist.id === targetPlaylistId) {
          const newItems = [...playlist.items];
          newItems.splice(index, 1);
          return { ...playlist, items: newItems };
        }
        return playlist;
      });
      const shouldResetShuffle =
        currentState.isShuffle && targetPlaylistId === currentState.activePlaylistId;
      return {
        playlists: updatedPlaylists,
        shuffleQueue: shouldResetShuffle
          ? resetQueueForPlaylist(currentState.shuffleQueue, targetPlaylistId)
          : currentState.shuffleQueue,
      };
    });
  },
  reorderPlaylist: (fromIndex, toIndex, playlistId) => {
    const state = get();
    const targetPlaylistId = playlistId || state.activePlaylistId;

    set((currentState) => {
      const updatedPlaylists = currentState.playlists.map((playlist) => {
        if (playlist.id === targetPlaylistId) {
          const newItems = [...playlist.items];
          const [removed] = newItems.splice(fromIndex, 1);
          newItems.splice(toIndex, 0, removed);
          return { ...playlist, items: newItems };
        }
        return playlist;
      });

      let newCurrentIndex: number | null = currentState.currentIndex;
      if (targetPlaylistId === currentState.activePlaylistId && newCurrentIndex !== null) {
        if (newCurrentIndex === fromIndex) {
          newCurrentIndex = toIndex;
        } else if (fromIndex < newCurrentIndex && toIndex >= newCurrentIndex) {
          newCurrentIndex -= 1;
        } else if (fromIndex > newCurrentIndex && toIndex <= newCurrentIndex) {
          newCurrentIndex += 1;
        }
      }

      const shouldResetShuffle =
        currentState.isShuffle && targetPlaylistId === currentState.activePlaylistId;

      return {
        playlists: updatedPlaylists,
        currentIndex: newCurrentIndex,
        shuffleQueue: shouldResetShuffle
          ? resetQueueForPlaylist(currentState.shuffleQueue, targetPlaylistId)
          : currentState.shuffleQueue,
      };
    });
  },
  reorderPlaylists: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.playlists.length ||
        toIndex >= state.playlists.length ||
        fromIndex === toIndex
      ) {
        return {};
      }
      const newPlaylists = [...state.playlists];
      const [removed] = newPlaylists.splice(fromIndex, 1);
      newPlaylists.splice(toIndex, 0, removed);
      // Reordering the tabs changes no playback state — the active playlist is
      // tracked by id, not by position.
      return { playlists: newPlaylists };
    }),
  moveItemBetweenPlaylists: (itemIndex, fromPlaylistId, toPlaylistId) => {
    const state = get();
    if (fromPlaylistId === toPlaylistId) {
      return false;
    }

    const fromPlaylist = state.playlists.find((playlist) => playlist.id === fromPlaylistId);
    const toPlaylist = state.playlists.find((playlist) => playlist.id === toPlaylistId);

    if (!fromPlaylist || !toPlaylist || itemIndex < 0 || itemIndex >= fromPlaylist.items.length) {
      return false;
    }

    const itemToMove = fromPlaylist.items[itemIndex];
    if (toPlaylist.items.some((existingItem) => existingItem.id === itemToMove.id)) {
      return false;
    }

    set((currentState) => {
      const updatedPlaylists = currentState.playlists.map((playlist) => {
        if (playlist.id === fromPlaylistId) {
          const newItems = [...playlist.items];
          newItems.splice(itemIndex, 1);
          return { ...playlist, items: newItems };
        }
        if (playlist.id === toPlaylistId) {
          return { ...playlist, items: [...playlist.items, itemToMove] };
        }
        return playlist;
      });

      // Only removal from the *active* playlist shifts the current index; the
      // target playlist always receives the item at the end.
      let newCurrentIndex: number | null = currentState.currentIndex;
      if (fromPlaylistId === currentState.activePlaylistId && newCurrentIndex !== null) {
        const remaining = fromPlaylist.items.length - 1;
        if (remaining === 0) {
          newCurrentIndex = null;
        } else if (itemIndex < newCurrentIndex) {
          newCurrentIndex -= 1;
        } else if (newCurrentIndex > remaining - 1) {
          newCurrentIndex = remaining - 1;
        }
      }

      let nextShuffleQueue = currentState.shuffleQueue;
      if (currentState.isShuffle) {
        if (fromPlaylistId === currentState.activePlaylistId) {
          nextShuffleQueue = resetQueueForPlaylist(nextShuffleQueue, fromPlaylistId);
        }
        if (toPlaylistId === currentState.activePlaylistId) {
          nextShuffleQueue = resetQueueForPlaylist(nextShuffleQueue, toPlaylistId);
        }
      }

      return {
        playlists: updatedPlaylists,
        currentIndex: newCurrentIndex,
        shuffleQueue: nextShuffleQueue,
      };
    });

    return true;
  },
  clearPlaylist: (playlistId) =>
    set((state) => {
      const targetPlaylistId = playlistId || state.activePlaylistId;
      const updatedPlaylists = state.playlists.map((playlist) =>
        playlist.id === targetPlaylistId ? { ...playlist, items: [] } : playlist,
      );

      const resetState =
        targetPlaylistId === state.activePlaylistId
          ? { currentIndex: null, currentVideoId: null, isPlaying: false }
          : {};

      const shouldResetShuffle = state.isShuffle && targetPlaylistId === state.activePlaylistId;

      return {
        playlists: updatedPlaylists,
        shuffleQueue: shouldResetShuffle
          ? resetQueueForPlaylist(state.shuffleQueue, targetPlaylistId)
          : state.shuffleQueue,
        ...resetState,
      };
    }),
  nextPlaylistName: () => {
    const { playlists } = get();
    return deriveNextPlaylistName(playlists);
  },
  createPlaylist: () => {
    if (!get().canCreatePlaylist) {
      return null;
    }

    const playlistId = generatePlaylistId();
    const newPlaylist: Playlist = {
      id: playlistId,
      name: get().nextPlaylistName(),
      items: [],
    };

    set((currentState) => {
      const constrained = enforcePlaylistBounds(
        [...currentState.playlists, newPlaylist],
        playlistId,
      );
      return {
        ...constrained,
        activePlaylistId: playlistId,
        currentVideoId: null,
        currentIndex: null,
        isPlaying: false,
        shuffleQueue: currentState.isShuffle
          ? resetQueueForPlaylist(currentState.shuffleQueue, playlistId)
          : currentState.shuffleQueue,
      };
    });

    return playlistId;
  },
  removePlaylist: (playlistId) => {
    const state = get();
    const playlistIndex = state.playlists.findIndex((playlist) => playlist.id === playlistId);

    if (playlistIndex === -1) {
      return false;
    }

    set((currentState) => {
      const updatedPlaylists = currentState.playlists.filter(
        (playlist) => playlist.id !== playlistId,
      );
      const removedActive = currentState.activePlaylistId === playlistId;

      let nextActivePlaylistId = currentState.activePlaylistId;
      if (removedActive) {
        if (updatedPlaylists.length === 0) {
          nextActivePlaylistId = "";
        } else if (playlistIndex < updatedPlaylists.length) {
          nextActivePlaylistId = updatedPlaylists[playlistIndex].id;
        } else {
          nextActivePlaylistId = updatedPlaylists[updatedPlaylists.length - 1].id;
        }
      }

      const constrained = enforcePlaylistBounds(updatedPlaylists, nextActivePlaylistId);
      const didChangeActive =
        removedActive || constrained.activePlaylistId !== currentState.activePlaylistId;

      let nextShuffleQueue = removeQueueForPlaylist(currentState.shuffleQueue, playlistId);
      if (currentState.isShuffle && didChangeActive && constrained.activePlaylistId) {
        nextShuffleQueue = resetQueueForPlaylist(nextShuffleQueue, constrained.activePlaylistId);
      }

      return {
        ...constrained,
        currentVideoId: didChangeActive ? null : currentState.currentVideoId,
        currentIndex: didChangeActive ? null : currentState.currentIndex,
        isPlaying: didChangeActive ? false : currentState.isPlaying,
        shuffleQueue: nextShuffleQueue,
      };
    });

    return true;
  },
  renamePlaylist: (playlistId, newName) => {
    set((state) => ({
      playlists: state.playlists.map((playlist) =>
        playlist.id === playlistId ? { ...playlist, name: newName } : playlist,
      ),
    }));
  },
  setActivePlaylist: (playlistId) => {
    const targetPlaylist = get().playlists.find((playlist) => playlist.id === playlistId);
    if (!targetPlaylist) {
      return;
    }

    set((state) => {
      const hasItems = targetPlaylist.items.length > 0;
      return {
        activePlaylistId: playlistId,
        currentIndex: hasItems ? 0 : null,
        currentVideoId: hasItems ? targetPlaylist.items[0].id : null,
        isPlaying: hasItems,
        shuffleQueue: state.isShuffle
          ? resetQueueForPlaylist(state.shuffleQueue, playlistId)
          : state.shuffleQueue,
      };
    });

    if (targetPlaylist.items.length > 0) {
      get().play(targetPlaylist.items[0].id);
    }
  },
  getActivePlaylist: () => {
    const { playlists, activePlaylistId } = get();
    return playlists.find((playlist) => playlist.id === activePlaylistId);
  },
});
