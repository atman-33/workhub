import { describe, expect, it } from "vitest";
import { MAX_PLAYLIST_COUNT } from "./playlist-helpers";
import {
  appendImportedPlaylists,
  parsePlaylistTransfer,
  serializePlaylists,
} from "./playlist-transfer";
import type { Playlist } from "./types";

const playlist = (id: string, name: string, itemIds: string[] = []): Playlist => ({
  id,
  name,
  items: itemIds.map((itemId) => ({ id: itemId, title: `Title ${itemId}` })),
});

describe("serializePlaylists / parsePlaylistTransfer", () => {
  it("round-trips playlists", () => {
    const source = [playlist("p1", "Focus", ["aaa", "bbb"]), playlist("p2", "Chill")];
    expect(parsePlaylistTransfer(serializePlaylists(source))).toEqual(source);
  });

  it("carries no playback state", () => {
    const parsed: unknown = JSON.parse(serializePlaylists([playlist("p1", "Focus")]));
    expect(parsed).not.toHaveProperty("is_shuffle");
    expect(parsed).not.toHaveProperty("loop_mode");
    expect(parsed).not.toHaveProperty("active_playlist_id");
  });

  it("rejects text that is not JSON", () => {
    expect(() => parsePlaylistTransfer("not json at all")).toThrow(/not a workhub playlist/i);
  });

  it("rejects JSON without the format marker", () => {
    expect(() => parsePlaylistTransfer('{"playlists":[]}')).toThrow(/not a workhub playlist/i);
  });

  it("rejects an export from a newer format version", () => {
    const text = JSON.stringify({
      format: "workhub-music-playlist",
      version: 99,
      playlists: [],
    });
    expect(() => parsePlaylistTransfer(text)).toThrow(/newer version/i);
  });

  it("rejects an export with no playlists", () => {
    expect(() => parsePlaylistTransfer(serializePlaylists([]))).toThrow(/no playlists/i);
  });

  it("drops malformed items and de-duplicates by video id", () => {
    const text = JSON.stringify({
      format: "workhub-music-playlist",
      version: 1,
      playlists: [{ id: "p1", name: "Mixed", items: [{ id: "aaa" }, { id: "aaa" }, {}, "junk"] }],
    });
    expect(parsePlaylistTransfer(text)[0].items).toEqual([{ id: "aaa" }]);
  });

  it("falls back to a generated name when the name is missing", () => {
    const text = JSON.stringify({
      format: "workhub-music-playlist",
      version: 1,
      playlists: [{ id: "p1", items: [] }],
    });
    expect(parsePlaylistTransfer(text)[0].name).toBe("Playlist 1");
  });
});

describe("appendImportedPlaylists", () => {
  it("appends without touching the existing playlists", () => {
    const existing = [playlist("p1", "Focus", ["aaa"])];
    const outcome = appendImportedPlaylists(existing, [playlist("x", "Chill", ["bbb"])]);

    expect(outcome.added).toBe(1);
    expect(outcome.skipped).toBe(0);
    expect(outcome.playlists[0]).toEqual(existing[0]);
    expect(outcome.playlists[1].items).toEqual([{ id: "bbb", title: "Title bbb" }]);
  });

  it("regenerates ids so an import can never collide with an existing playlist", () => {
    const outcome = appendImportedPlaylists([playlist("p1", "Focus")], [playlist("p1", "Other")]);
    expect(outcome.playlists[1].id).not.toBe("p1");
  });

  it("disambiguates duplicate names", () => {
    const outcome = appendImportedPlaylists(
      [playlist("p1", "Focus")],
      [playlist("x", "Focus"), playlist("y", "Focus")],
    );
    expect(outcome.playlists.map((p) => p.name)).toEqual(["Focus", "Focus (2)", "Focus (3)"]);
  });

  it("skips playlists past the limit instead of evicting existing ones", () => {
    const existing = Array.from({ length: MAX_PLAYLIST_COUNT - 1 }, (_, index) =>
      playlist(`p${index}`, `Playlist ${index}`),
    );
    const outcome = appendImportedPlaylists(existing, [playlist("x", "A"), playlist("y", "B")]);

    expect(outcome.added).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect(outcome.playlists).toHaveLength(MAX_PLAYLIST_COUNT);
  });

  it("adds nothing when the limit is already reached", () => {
    const existing = Array.from({ length: MAX_PLAYLIST_COUNT }, (_, index) =>
      playlist(`p${index}`, `Playlist ${index}`),
    );
    const outcome = appendImportedPlaylists(existing, [playlist("x", "A")]);

    expect(outcome.added).toBe(0);
    expect(outcome.skipped).toBe(1);
    expect(outcome.playlists).toEqual(existing);
  });
});
