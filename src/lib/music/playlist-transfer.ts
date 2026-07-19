import { generatePlaylistId, MAX_PLAYLIST_COUNT } from "./playlist-helpers";
import type { Playlist, PlaylistItem } from "./types";

/** Marker identifying a file/clipboard payload as a workhub playlist export. */
export const PLAYLIST_TRANSFER_FORMAT = "workhub-music-playlist";
export const PLAYLIST_TRANSFER_VERSION = 1;

/**
 * Portable playlist payload. Deliberately carries *only* playlists — playback
 * state (active tab, loop, shuffle) is machine-local and would be noise when
 * reproducing a library on another workhub install.
 */
export interface PlaylistTransfer {
  format: typeof PLAYLIST_TRANSFER_FORMAT;
  version: number;
  exported_at: string;
  playlists: Playlist[];
}

export const serializePlaylists = (playlists: Playlist[], now: Date = new Date()) =>
  `${JSON.stringify(
    {
      format: PLAYLIST_TRANSFER_FORMAT,
      version: PLAYLIST_TRANSFER_VERSION,
      exported_at: now.toISOString(),
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        items: playlist.items.map((item) => ({ id: item.id, title: item.title })),
      })),
    } satisfies PlaylistTransfer,
    null,
    2,
  )}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseItems = (value: unknown): PlaylistItem[] => {
  if (!Array.isArray(value)) return [];
  const items: PlaylistItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    items.push(typeof raw.title === "string" ? { id: raw.id, title: raw.title } : { id: raw.id });
  }
  return items;
};

/**
 * Reads an exported payload. Throws with a user-facing message when the text is
 * not a playlist export — imported data is untrusted (hand-edited files, stray
 * clipboard content), so every field is checked rather than cast.
 */
export const parsePlaylistTransfer = (text: string): Playlist[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failInvalid();
  }

  if (!isRecord(parsed) || parsed.format !== PLAYLIST_TRANSFER_FORMAT) {
    return failInvalid();
  }
  if (typeof parsed.version !== "number" || parsed.version > PLAYLIST_TRANSFER_VERSION) {
    throw new Error(
      `This export was made by a newer version of workhub (format v${String(parsed.version)}).`,
    );
  }
  if (!Array.isArray(parsed.playlists)) {
    return failInvalid();
  }

  const playlists = parsed.playlists.filter(isRecord).map((raw, index) => ({
    // Ids are regenerated on import anyway; keep the incoming one only as a hint.
    id: typeof raw.id === "string" && raw.id ? raw.id : generatePlaylistId(),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Playlist ${index + 1}`,
    items: parseItems(raw.items),
  }));

  if (playlists.length === 0) {
    throw new Error("The file contains no playlists.");
  }
  return playlists;
};

const failInvalid = (): never => {
  throw new Error("Not a workhub playlist export.");
};

/** Makes `name` unique against `taken` by appending " (2)", " (3)", ... */
const uniqueName = (name: string, taken: Set<string>) => {
  if (!taken.has(name)) return name;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${name} (${suffix})`;
    if (!taken.has(candidate)) return candidate;
  }
};

export interface ImportOutcome {
  playlists: Playlist[];
  /** How many imported playlists were appended. */
  added: number;
  /** How many were dropped because the playlist limit was reached. */
  skipped: number;
}

/**
 * Appends imported playlists to the existing ones. Import never replaces or
 * edits what is already there: ids are regenerated so nothing can collide, and
 * anything past `MAX_PLAYLIST_COUNT` is reported as skipped rather than
 * silently evicting an existing playlist.
 */
export const appendImportedPlaylists = (
  existing: Playlist[],
  imported: Playlist[],
): ImportOutcome => {
  const room = Math.max(0, MAX_PLAYLIST_COUNT - existing.length);
  const takenNames = new Set(existing.map((playlist) => playlist.name));
  const takenIds = new Set(existing.map((playlist) => playlist.id));

  const appended = imported.slice(0, room).map((playlist) => {
    let id = generatePlaylistId();
    while (takenIds.has(id)) id = generatePlaylistId();
    takenIds.add(id);

    const name = uniqueName(playlist.name, takenNames);
    takenNames.add(name);

    return { id, name, items: playlist.items };
  });

  return {
    playlists: [...existing, ...appended],
    added: appended.length,
    skipped: imported.length - appended.length,
  };
};
