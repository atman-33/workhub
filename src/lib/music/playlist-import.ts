import type { PlaylistItem } from "./types";

/**
 * The IFrame player exposes at most this many entries of a playlist; longer
 * playlists come back truncated with no indication from the API itself.
 */
export const PLAYER_PLAYLIST_LIMIT = 200;

/** Shown whenever the IFrame player will not enumerate a playlist. */
export const UNSUPPORTED_PLAYLIST_MESSAGE =
  "Could not read this playlist. It may be private, a generated mix, or unavailable.";

/**
 * Playlist ids the IFrame player cannot enumerate:
 * - `RD*` / `RDMM*` are mixes generated per viewer, not stored lists.
 * - `LL` (liked videos) and `WL` (watch later) are private to a signed-in
 *   account, which an embedded player never has.
 */
const isEnumerablePlaylistId = (id: string) =>
  /^[A-Za-z0-9_-]{12,}$/.test(id) && !id.startsWith("RD");

const readListParam = (url: string) => {
  try {
    return new URL(url).searchParams.get("list");
  } catch {
    // Not a URL — fall back to a plain regex so a pasted id still works.
    return /[?&]list=([^#&?]+)/.exec(url)?.[1] ?? null;
  }
};

/** True when the URL carries a playlist at all, enumerable or not. */
export const hasPlaylistParam = (url: string) => readListParam(url.trim()) !== null;

/**
 * Extracts an enumerable playlist id from a YouTube URL (or a bare id).
 * Returns null when there is no playlist, or when the playlist is one the
 * embedded player cannot list.
 */
export const extractPlaylistId = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const listParam = readListParam(trimmed) ?? (trimmed.includes("/") ? null : trimmed);
  if (!listParam) {
    return null;
  }

  return isEnumerablePlaylistId(listParam) ? listParam : null;
};

/** The subset of the IFrame API used to enumerate a playlist. */
export interface PlaylistReaderPlayer {
  cuePlaylist: (args: { listType: string; list: string }) => void;
  getPlaylist: () => string[] | null | undefined;
  stopVideo?: () => void;
}

interface ReadOptions {
  /** Polls before giving up. Default covers roughly 10 seconds. */
  attempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isVideoId = (id: unknown): id is string => typeof id === "string" && id.length === 11;

/**
 * Cues a playlist into a player and polls `getPlaylist()` until the ids arrive.
 *
 * Polling rather than waiting on `onStateChange`: a cued playlist reaches its
 * CUED state before `getPlaylist()` is populated in some player builds, and an
 * unreadable list (private, mix) fires no terminal event at all — it just never
 * populates. Polling handles both with one timeout.
 */
export const readPlaylistVideoIds = async (
  player: PlaylistReaderPlayer,
  playlistId: string,
  { attempts = 50, intervalMs = 200, sleep = defaultSleep }: ReadOptions = {},
) => {
  player.cuePlaylist({ listType: "playlist", list: playlistId });

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const raw = player.getPlaylist();
    if (raw && raw.length > 0) {
      // The cue queues the first track; stop it so importing never becomes
      // playback (the player is off-screen and would be heard but not seen).
      player.stopVideo?.();
      return [...new Set(raw.filter(isVideoId))];
    }
    await sleep(intervalMs);
  }

  player.stopVideo?.();
  throw new Error(UNSUPPORTED_PLAYLIST_MESSAGE);
};

interface TitleOptions {
  fetchTitle: (videoId: string) => Promise<string>;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Same shape the manual add form falls back to when oEmbed is unavailable. */
const fallbackTitle = (videoId: string) => `Video ${videoId.substring(0, 5)}`;

/**
 * Resolves a title for every id, a few lookups at a time. Titles come from the
 * same key-less oEmbed endpoint the single-URL form uses, so a failure for one
 * video only costs that video its title.
 */
export const fetchItemTitles = async (
  videoIds: string[],
  { fetchTitle, concurrency = 4, onProgress }: TitleOptions,
): Promise<PlaylistItem[]> => {
  const items = new Array<PlaylistItem>(videoIds.length);
  let nextIndex = 0;
  let done = 0;

  const worker = async () => {
    while (nextIndex < videoIds.length) {
      const index = nextIndex;
      nextIndex += 1;
      const videoId = videoIds[index];
      let title: string;
      try {
        title = await fetchTitle(videoId);
      } catch {
        title = fallbackTitle(videoId);
      }
      items[index] = { id: videoId, title };
      done += 1;
      onProgress?.(done, videoIds.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, videoIds.length) }, () => worker()),
  );

  return items;
};
