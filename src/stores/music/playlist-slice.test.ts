import { beforeEach, describe, expect, it } from "vitest";
import type { Playlist } from "@/lib/music/types";
import { useMusicStore } from "./index";

const playlist = (id: string, itemIds: string[]): Playlist => ({
  id,
  name: id,
  items: itemIds.map((itemId) => ({ id: itemId, title: `title-${itemId}` })),
});

const seed = (playlists: Playlist[], activePlaylistId: string, currentIndex: number | null) => {
  useMusicStore.setState({
    playlists,
    activePlaylistId,
    currentIndex,
    isShuffle: false,
    shuffleQueue: {},
    hydrated: true,
  });
};

const itemIdsOf = (playlistId: string) =>
  useMusicStore
    .getState()
    .playlists.find((p) => p.id === playlistId)
    ?.items.map((item) => item.id);

beforeEach(() => {
  seed([playlist("a", ["v1", "v2", "v3"]), playlist("b", ["v9"])], "a", 0);
});

describe("reorderPlaylists", () => {
  it("moves a playlist to a new position without changing the active one", () => {
    useMusicStore.getState().reorderPlaylists(0, 1);

    expect(useMusicStore.getState().playlists.map((p) => p.id)).toEqual(["b", "a"]);
    expect(useMusicStore.getState().activePlaylistId).toBe("a");
  });

  it("ignores out-of-range and no-op moves", () => {
    const before = useMusicStore.getState().playlists;

    useMusicStore.getState().reorderPlaylists(0, 0);
    useMusicStore.getState().reorderPlaylists(0, 5);
    useMusicStore.getState().reorderPlaylists(-1, 1);

    expect(useMusicStore.getState().playlists).toBe(before);
  });
});

describe("moveItemBetweenPlaylists", () => {
  it("moves an item to the end of the target playlist", () => {
    expect(useMusicStore.getState().moveItemBetweenPlaylists(1, "a", "b")).toBe(true);

    expect(itemIdsOf("a")).toEqual(["v1", "v3"]);
    expect(itemIdsOf("b")).toEqual(["v9", "v2"]);
  });

  it("shifts currentIndex when an item before the current one leaves the active playlist", () => {
    seed([playlist("a", ["v1", "v2", "v3"]), playlist("b", [])], "a", 2);

    useMusicStore.getState().moveItemBetweenPlaylists(0, "a", "b");

    expect(useMusicStore.getState().currentIndex).toBe(1);
  });

  it("clamps currentIndex when the last item leaves the active playlist", () => {
    seed([playlist("a", ["v1", "v2"]), playlist("b", [])], "a", 1);

    useMusicStore.getState().moveItemBetweenPlaylists(1, "a", "b");

    expect(useMusicStore.getState().currentIndex).toBe(0);
  });

  it("clears currentIndex when the active playlist becomes empty", () => {
    seed([playlist("a", ["v1"]), playlist("b", [])], "a", 0);

    useMusicStore.getState().moveItemBetweenPlaylists(0, "a", "b");

    expect(useMusicStore.getState().currentIndex).toBeNull();
  });

  it("refuses a move that would duplicate an item in the target", () => {
    seed([playlist("a", ["v1"]), playlist("b", ["v1"])], "a", 0);

    expect(useMusicStore.getState().moveItemBetweenPlaylists(0, "a", "b")).toBe(false);
    expect(itemIdsOf("a")).toEqual(["v1"]);
    expect(itemIdsOf("b")).toEqual(["v1"]);
  });

  it("refuses unknown playlists, out-of-range indexes, and same-playlist moves", () => {
    const { moveItemBetweenPlaylists } = useMusicStore.getState();

    expect(moveItemBetweenPlaylists(0, "a", "a")).toBe(false);
    expect(moveItemBetweenPlaylists(0, "a", "missing")).toBe(false);
    expect(moveItemBetweenPlaylists(9, "a", "b")).toBe(false);
    expect(moveItemBetweenPlaylists(-1, "a", "b")).toBe(false);
  });
});
