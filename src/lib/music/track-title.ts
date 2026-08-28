import type { Playlist } from "./types";

/**
 * Display title for the currently loaded video.
 *
 * Falls back to a short form of the video id when the playlist entry carries no
 * title (imported entries may not have one yet). Returns `null` when nothing is
 * loaded, which callers use to hide their player UI entirely.
 */
export const currentTrackTitle = (
  playlist: Playlist | null | undefined,
  currentVideoId: string | null,
): string | null => {
  if (!currentVideoId) return null;
  const item = playlist?.items.find((entry) => entry.id === currentVideoId);
  return item?.title ?? `Video ${currentVideoId.substring(0, 5)}`;
};
