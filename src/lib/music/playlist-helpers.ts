import type { Playlist } from "./types";

export const MAX_PLAYLIST_COUNT = 10;

const PLAYLIST_NAME_PATTERN = /^Playlist (\d+)$/i;

export const deriveNextPlaylistName = (playlists: Playlist[]) => {
  const usedNumbers = new Set<number>();
  let highest = 0;

  for (const playlist of playlists) {
    const match = PLAYLIST_NAME_PATTERN.exec(playlist.name);
    if (match) {
      const value = Number.parseInt(match[1], 10);
      if (!Number.isNaN(value)) {
        usedNumbers.add(value);
        if (value > highest) {
          highest = value;
        }
      }
    }
  }

  for (let index = 1; index <= MAX_PLAYLIST_COUNT; index += 1) {
    if (!usedNumbers.has(index)) {
      return `Playlist ${index}`;
    }
  }

  return `Playlist ${highest + 1}`;
};

export const enforcePlaylistBounds = (playlists: Playlist[], activePlaylistId: string) => {
  const trimmed = playlists.slice(0, MAX_PLAYLIST_COUNT);
  let nextActiveId = activePlaylistId;

  if (trimmed.length === 0) {
    nextActiveId = "";
  } else if (!trimmed.some((playlist) => playlist.id === nextActiveId)) {
    nextActiveId = trimmed[0].id;
  }

  return {
    playlists: trimmed,
    activePlaylistId: nextActiveId,
    canCreatePlaylist: trimmed.length < MAX_PLAYLIST_COUNT,
  };
};

const createUniqueSegment = () => {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${timePart}-${randomPart}`;
};

export const generatePlaylistId = () => `playlist-${createUniqueSegment()}`;

/** Ensures every playlist has a unique, non-empty id (data may be hand-edited). */
export const sanitizePlaylistIdentifiers = (playlists: Playlist[], activePlaylistId: string) => {
  const seen = new Set<string>();
  const idMap = new Map<string, string>();

  const updatedPlaylists = playlists.map((playlist) => {
    const originalId = playlist.id;
    let nextId = originalId;

    if (!nextId || seen.has(nextId)) {
      let generatedId = "";
      do {
        generatedId = generatePlaylistId();
      } while (seen.has(generatedId));
      if (originalId && !idMap.has(originalId)) {
        idMap.set(originalId, generatedId);
      }
      nextId = generatedId;
    } else if (!idMap.has(originalId)) {
      idMap.set(originalId, nextId);
    }

    seen.add(nextId);
    return { ...playlist, id: nextId };
  });

  let nextActivePlaylistId = idMap.get(activePlaylistId) ?? activePlaylistId;
  if (!updatedPlaylists.some((playlist) => playlist.id === nextActivePlaylistId)) {
    nextActivePlaylistId = updatedPlaylists[0]?.id ?? "";
  }

  return { playlists: updatedPlaylists, activePlaylistId: nextActivePlaylistId };
};

/** Extracts the 11-char video id from the usual YouTube URL shapes. */
export const extractVideoId = (url: string) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};
