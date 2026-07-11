import type { Playlist } from "./types";

export type ShuffleQueueMap = Record<string, string[]>;

const getPlaylistItemIds = (playlist?: Playlist) =>
  playlist ? playlist.items.map((item) => item.id) : [];

export const buildShuffleQueue = (playlist?: Playlist, excludeId?: string | null) => {
  const ids = getPlaylistItemIds(playlist);
  if (ids.length <= 1) {
    return ids;
  }
  const filtered = ids.filter((id) => id !== excludeId);
  return filtered.length > 0 ? filtered : ids;
};

export const sanitizeShuffleQueue = (
  queue: string[] | undefined,
  playlist: Playlist | undefined,
  excludeId: string | null,
) => {
  const ids = getPlaylistItemIds(playlist);
  if (ids.length === 0) {
    return [];
  }
  const allowed = new Set(ids);
  const filtered = (queue ?? []).filter((id) => allowed.has(id) && id !== excludeId);
  if (filtered.length > 0) {
    return filtered;
  }
  return buildShuffleQueue(playlist, excludeId);
};

export const drawFromShuffleQueue = (
  queue: string[] | undefined,
  playlist: Playlist | undefined,
  excludeId: string | null,
) => {
  const candidates = sanitizeShuffleQueue(queue, playlist, excludeId);
  if (candidates.length === 0) {
    return { nextId: undefined as string | undefined, queue: [] as string[] };
  }
  const randomIndex = Math.floor(Math.random() * candidates.length);
  const nextId = candidates[randomIndex];
  const remaining = candidates.filter((_, index) => index !== randomIndex);
  const nextQueue = remaining.length > 0 ? remaining : buildShuffleQueue(playlist, nextId);
  return { nextId, queue: nextQueue };
};

export const rebuildShuffleQueues = (
  queueMap: ShuffleQueueMap,
  playlists: Playlist[],
  activePlaylistId: string,
  currentVideoId: string | null,
) => {
  const next: ShuffleQueueMap = {};
  for (const playlist of playlists) {
    const excludeId = playlist.id === activePlaylistId ? currentVideoId : null;
    next[playlist.id] = sanitizeShuffleQueue(queueMap[playlist.id], playlist, excludeId);
  }
  return next;
};

export const withQueueForPlaylist = (
  queueMap: ShuffleQueueMap,
  playlistId: string,
  queue: string[],
) => ({
  ...queueMap,
  [playlistId]: queue,
});

export const resetQueueForPlaylist = (queueMap: ShuffleQueueMap, playlistId: string) =>
  withQueueForPlaylist(queueMap, playlistId, []);

export const removeQueueForPlaylist = (queueMap: ShuffleQueueMap, playlistId: string) => {
  if (!(playlistId in queueMap)) {
    return queueMap;
  }
  const { [playlistId]: _removed, ...rest } = queueMap;
  return rest;
};
