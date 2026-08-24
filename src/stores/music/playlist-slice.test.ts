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

describe("importPlaylists", () => {
  it("appends imported playlists without disturbing playback", () => {
    const result = useMusicStore.getState().importPlaylists([playlist("imported", ["v42"])]);

    expect(result).toEqual({ added: 1, skipped: 0 });
    expect(useMusicStore.getState().playlists).toHaveLength(3);
    expect(useMusicStore.getState().activePlaylistId).toBe("a");
    expect(useMusicStore.getState().currentIndex).toBe(0);
  });

  it("keeps the create-playlist affordance in sync with the new count", () => {
    const many = Array.from({ length: 8 }, (_, index) => playlist(`x${index}`, []));
    useMusicStore.getState().importPlaylists(many);

    expect(useMusicStore.getState().playlists).toHaveLength(10);
    expect(useMusicStore.getState().canCreatePlaylist).toBe(false);
  });

  it("leaves the state untouched when nothing fits", () => {
    const many = Array.from({ length: 8 }, (_, index) => playlist(`x${index}`, []));
    useMusicStore.getState().importPlaylists(many);

    const before = useMusicStore.getState().playlists;
    expect(useMusicStore.getState().importPlaylists([playlist("late", [])])).toEqual({
      added: 0,
      skipped: 1,
    });
    expect(useMusicStore.getState().playlists).toBe(before);
  });
});

describe("addManyToPlaylist", () => {
  it("appends every new item in one update and reports the counts", () => {
    const outcome = useMusicStore.getState().addManyToPlaylist([
      { id: "v4", title: "title-v4" },
      { id: "v5", title: "title-v5" },
    ]);

    expect(outcome).toEqual({ added: 2, skipped: 0 });
    expect(itemIdsOf("a")).toEqual(["v1", "v2", "v3", "v4", "v5"]);
  });

  it("skips items already in the target playlist, and duplicates within the batch", () => {
    const outcome = useMusicStore.getState().addManyToPlaylist([
      { id: "v2", title: "title-v2" },
      { id: "v4", title: "title-v4" },
      { id: "v4", title: "title-v4 again" },
    ]);

    expect(outcome).toEqual({ added: 1, skipped: 2 });
    expect(itemIdsOf("a")).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("leaves the state untouched when nothing new arrives", () => {
    const before = useMusicStore.getState().playlists;

    const outcome = useMusicStore.getState().addManyToPlaylist([{ id: "v1", title: "title-v1" }]);

    expect(outcome).toEqual({ added: 0, skipped: 1 });
    expect(useMusicStore.getState().playlists).toBe(before);
  });

  it("adds to a named playlist without touching the active one", () => {
    const outcome = useMusicStore
      .getState()
      .addManyToPlaylist([{ id: "v7", title: "title-v7" }], "b");

    expect(outcome).toEqual({ added: 1, skipped: 0 });
    expect(itemIdsOf("b")).toEqual(["v9", "v7"]);
    expect(itemIdsOf("a")).toEqual(["v1", "v2", "v3"]);
  });

  it("does not disturb playback of the current track", () => {
    useMusicStore.setState({ currentIndex: 1, currentVideoId: "v2", isPlaying: true });

    useMusicStore.getState().addManyToPlaylist([{ id: "v4", title: "title-v4" }]);

    const state = useMusicStore.getState();
    expect(state.currentIndex).toBe(1);
    expect(state.currentVideoId).toBe("v2");
    expect(state.isPlaying).toBe(true);
  });

  it("starts the index at the first track when the playlist was empty", () => {
    seed([playlist("empty", [])], "empty", null);

    useMusicStore.getState().addManyToPlaylist([{ id: "v1", title: "title-v1" }]);

    expect(useMusicStore.getState().currentIndex).toBe(0);
  });

  it("ignores an unknown playlist id", () => {
    const outcome = useMusicStore
      .getState()
      .addManyToPlaylist([{ id: "v7", title: "title-v7" }], "missing");

    expect(outcome).toEqual({ added: 0, skipped: 1 });
  });
});
