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
  destroy?: () => void;
}

export interface PlaylistSlice {
  playlists: Playlist[];
  maxPlaylistCount: number;
  canCreatePlaylist: boolean;
  activePlaylistId: string;
  addToPlaylist: (item: PlaylistItem, playlistId?: string) => boolean;
  removeFromPlaylist: (index: number, playlistId?: string) => void;
  reorderPlaylist: (fromIndex: number, toIndex: number, playlistId?: string) => void;
  clearPlaylist: (playlistId?: string) => void;
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
