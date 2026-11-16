import { describe, expect, it } from "vitest";
import { normalizeForSearch, searchPlaylists } from "./item-search";
import type { Playlist } from "./types";

const playlist = (id: string, titles: (string | undefined)[]): Playlist => ({
  id,
  name: `list-${id}`,
  items: titles.map((title, i) => ({ id: `${id}${i}`, title })),
});

const ids = (result: ReturnType<typeof searchPlaylists>) =>
  result.groups.map((g) => g.hits.map((h) => h.item.id));

describe("normalizeForSearch", () => {
  it("folds case, width and katakana", () => {
    expect(normalizeForSearch("ＡＢＣ")).toBe("abc");
    expect(normalizeForSearch("ﾊﾟﾌｭｰﾑ")).toBe("ぱふゅーむ");
    expect(normalizeForSearch("パフューム")).toBe("ぱふゅーむ");
  });
});

describe("searchPlaylists", () => {
  const lists = [
    playlist("a", ["Hello World", "hello again", undefined, "Other"]),
    playlist("b", ["Nothing", "HELLO there"]),
  ];

  it("returns nothing for a blank query", () => {
    expect(searchPlaylists(lists, "   ", 50)).toEqual({ groups: [], omitted: 0 });
  });

  it("matches case-insensitively and groups by playlist in order", () => {
    const result = searchPlaylists(lists, "HELLO", 50);
    expect(ids(result)).toEqual([["a0", "a1"], ["b1"]]);
    expect(result.groups[0].playlist.id).toBe("a");
  });

  it("keeps each track's original index", () => {
    const result = searchPlaylists(lists, "there", 50);
    expect(result.groups[0].hits[0].index).toBe(1);
  });

  it("requires every term (AND), including the full-width space", () => {
    expect(ids(searchPlaylists(lists, "hello world", 50))).toEqual([["a0"]]);
    expect(ids(searchPlaylists(lists, "hello　again", 50))).toEqual([["a1"]]);
    expect(ids(searchPlaylists(lists, "hello zzz", 50))).toEqual([]);
  });

  it("never matches a track without a title", () => {
    const result = searchPlaylists([playlist("x", [undefined, ""])], "video", 50);
    expect(result.groups).toEqual([]);
  });

  it("leaves out playlists with no hits", () => {
    expect(searchPlaylists(lists, "other", 50).groups.map((g) => g.playlist.id)).toEqual(["a"]);
  });

  it("matches katakana with hiragana and full-width with half-width", () => {
    const jp = [playlist("j", ["パフューム Live", "ＡＢＣ song"])];
    expect(ids(searchPlaylists(jp, "ぱふゅーむ", 50))).toEqual([["j0"]]);
    expect(ids(searchPlaylists(jp, "abc", 50))).toEqual([["j1"]]);
    expect(ids(searchPlaylists(jp, "ＬＩＶＥ", 50))).toEqual([["j0"]]);
  });

  it("cuts at the limit and counts what was left out", () => {
    const many = [playlist("m", ["x1", "x2", "x3"]), playlist("n", ["x4", "x5"])];
    const result = searchPlaylists(many, "x", 4);
    expect(ids(result)).toEqual([["m0", "m1", "m2"], ["n0"]]);
    expect(result.omitted).toBe(1);
    const tight = searchPlaylists(many, "x", 3);
    expect(tight.groups.map((g) => g.playlist.id)).toEqual(["m"]);
    expect(tight.omitted).toBe(2);
  });

  describe("highlight ranges", () => {
    const first = (title: string, query: string) =>
      searchPlaylists([playlist("h", [title])], query, 50).groups[0].hits[0].ranges;

    it("covers every occurrence in the original title", () => {
      expect(first("Hello hello", "hello")).toEqual([
        [0, 5],
        [6, 11],
      ]);
    });

    it("merges overlapping and adjacent terms", () => {
      expect(first("abcdef", "abc cde")).toEqual([[0, 5]]);
      expect(first("abcdef", "abc def")).toEqual([[0, 6]]);
    });

    it("keeps separate terms apart", () => {
      expect(first("foo xx bar", "foo bar")).toEqual([
        [0, 3],
        [7, 10],
      ]);
    });

    it("maps back to the original text after folding", () => {
      expect(first("x ＡＢＣ y", "abc")).toEqual([[2, 5]]);
      expect(first("あパフューム", "ぱふゅーむ")).toEqual([[1, 6]]);
    });

    it("spans the whole source character when folding expands it", () => {
      // U+3300 expands to several characters under NFKC; any match inside it
      // highlights the single source character.
      expect(first("a㌀b", "あ")).toEqual([[1, 2]]);
    });
  });
});
