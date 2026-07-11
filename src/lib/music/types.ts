export interface PlaylistItem {
  id: string;
  title?: string;
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
}

export type LoopMode = "all" | "one";

/** Wire format matching the Rust `MusicData` struct (snake_case fields). */
export interface MusicData {
  playlists: Playlist[];
  active_playlist_id: string;
  loop_mode: LoopMode;
  is_shuffle: boolean;
}
