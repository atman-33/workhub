import type { StateCreator } from "zustand";
import type { ShuffleQueueMap } from "@/lib/music/shuffle-queue";
import type { LoopMode, MusicData, Playlist, PlaylistItem } from "@/lib/music/types";

export interface PlaybackSlice {
  isPlaying: boolean;
  currentVideoId: string | null;
  currentIndex: number | null;
  loopMode: LoopMode;
  isShuffle: boolean;
  shuffleQueue: ShuffleQueueMap;
  playerInstance: YouTubePlayerLike | null;
  setPlayerInstance: (player: YouTubePlayerLike) => void;
  play: (videoId: string) => void;
  pause: () => void;
  setPlayingStateToFalse: () => void;
  resume: () => void;
  toggleLoop: () => void;
  toggleShuffle: () => void;
  playNext: () => void;
  playPrevious: () => void;
}

/** The subset of the YouTube IFrame API player the store drives. */
export interface YouTubePlayerLike {
  loadVideoById: (id: string) => void;
  cueVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  /** Loads a whole playlist without playing it; the ids then become readable
   *  through getPlaylist(). Used only by the import player. */
  cuePlaylist: (args: { listType: string; list: string }) => void;
  getPlaylist: () => string[] | null | undefined;
  destroy?: () => void;
}

export interface PlaylistSlice {
  playlists: Playlist[];
  maxPlaylistCount: number;
  canCreatePlaylist: boolean;
  activePlaylistId: string;
  addToPlaylist: (item: PlaylistItem, playlistId?: string) => boolean;
  /** Appends several items in a single update (used by the playlist import).
   *  Items already in the target playlist — and duplicates inside the batch —
   *  are skipped, and playback is deliberately left untouched. */
  addManyToPlaylist: (
    items: PlaylistItem[],
    playlistId?: string,
  ) => { added: number; skipped: number };
  removeFromPlaylist: (index: number, playlistId?: string) => void;
  reorderPlaylist: (fromIndex: number, toIndex: number, playlistId?: string) => void;
  /** Reorders the playlists themselves (tab order). */
  reorderPlaylists: (fromIndex: number, toIndex: number) => void;
  /** Moves one item from one playlist to another. False if the move is impossible
   *  (unknown playlist, bad index, or the item already exists in the target). */
  moveItemBetweenPlaylists: (
    itemIndex: number,
    fromPlaylistId: string,
    toPlaylistId: string,
  ) => boolean;
  clearPlaylist: (playlistId?: string) => void;
  /** Appends playlists from an export. Existing playlists are never modified;
   *  returns how many were added and how many hit the playlist limit. */
  importPlaylists: (imported: Playlist[]) => { added: number; skipped: number };
  nextPlaylistName: () => string;
  createPlaylist: () => string | null;
  removePlaylist: (playlistId: string) => boolean;
  renamePlaylist: (playlistId: string, newName: string) => void;
  setActivePlaylist: (playlistId: string) => void;
  getActivePlaylist: () => Playlist | undefined;
}

export interface PersistenceSlice {
  /** False until the vault data has been loaded; saves are suppressed before that. */
  hydrated: boolean;
  hydrate: (data: MusicData | null) => void;
}

export type MusicState = PlaybackSlice & PlaylistSlice & PersistenceSlice;
export type MusicStoreSlice<T> = StateCreator<MusicState, [], [], T>;
