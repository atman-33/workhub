import type { Playlist, PlaylistItem } from "./types";

/** A half-open `[start, end)` range of UTF-16 code units in the original title. */
export type MatchRange = [number, number];

export interface SearchHit {
  item: PlaylistItem;
  /** Position of the item in its playlist's `items`. */
  index: number;
  /** Where the query terms matched in `item.title`, for highlighting. */
  ranges: MatchRange[];
}

export interface PlaylistSearchGroup {
  playlist: Playlist;
  hits: SearchHit[];
}

export interface PlaylistSearchResult {
  /** Playlists in their own order; playlists with nothing to show are left out. */
  groups: PlaylistSearchGroup[];
  /** Hits that matched but were cut by the limit. */
  omitted: number;
}

const KATAKANA_FIRST = 0x30a1;
const KATAKANA_LAST = 0x30f6;
const KATAKANA_TO_HIRAGANA = 0x60;

/**
 * Splits text into units that must be normalized together: a base character
 * with the combining marks that follow it, including the half-width (semi-)voiced
 * sound marks, which NFKC only composes with their preceding kana.
 */
const clusters = (text: string): string[] => {
  const out: string[] = [];
  for (const ch of text) {
    if (out.length > 0 && /^[\p{M}゙゚ﾞﾟ]$/u.test(ch)) {
      out[out.length - 1] += ch;
    } else {
      out.push(ch);
    }
  }
  return out;
};

const foldChar = (ch: string) =>
  Array.from(ch.normalize("NFKC").toLowerCase(), (c) => {
    const code = c.codePointAt(0) ?? 0;
    return code >= KATAKANA_FIRST && code <= KATAKANA_LAST
      ? String.fromCodePoint(code - KATAKANA_TO_HIRAGANA)
      : c;
  }).join("");

/**
 * Folds text for comparison: NFKC (full-width and half-width forms agree),
 * lower case, and katakana to hiragana. Kanji readings are not covered.
 */
export function normalizeForSearch(text: string): string {
  return clusters(text).map(foldChar).join("");
}

/** Splits a query into folded terms; blank input yields none. */
export function searchTermsOf(query: string): string[] {
  return normalizeForSearch(query).split(/\s+/).filter(Boolean);
}

interface Folded {
  text: string;
  /** For each UTF-16 unit of `text`, the original range it came from. */
  origin: MatchRange[];
}

/** Folds a title while remembering where every folded unit came from. */
function foldWithOrigin(title: string): Folded {
  let text = "";
  const origin: MatchRange[] = [];
  let position = 0;
  for (const ch of clusters(title)) {
    const folded = foldChar(ch);
    const range: MatchRange = [position, position + ch.length];
    for (let i = 0; i < folded.length; i++) {
      origin.push(range);
    }
    text += folded;
    position += ch.length;
  }
  return { text, origin };
}

/**
 * Ranges of the original title covered by any term, merged and sorted, or
 * null when some term does not occur (every term must).
 */
function matchRanges(title: string, terms: string[]): MatchRange[] | null {
  const { text, origin } = foldWithOrigin(title);
  const found: MatchRange[] = [];
  for (const term of terms) {
    let from = text.indexOf(term);
    if (from < 0) {
      return null;
    }
    while (from >= 0) {
      found.push([origin[from][0], origin[from + term.length - 1][1]]);
      from = text.indexOf(term, from + term.length);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: MatchRange[] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

/**
 * Searches every playlist's track titles. A track matches when each
 * whitespace-separated term occurs in its title; tracks without a title never
 * match. At most `limit` hits are returned, in playlist order, and the rest
 * are counted in `omitted`.
 */
export function searchPlaylists(
  playlists: Playlist[],
  query: string,
  limit: number,
): PlaylistSearchResult {
  const terms = searchTermsOf(query);
  if (terms.length === 0) {
    return { groups: [], omitted: 0 };
  }
  const groups: PlaylistSearchGroup[] = [];
  let shown = 0;
  let omitted = 0;
  for (const playlist of playlists) {
    const hits: SearchHit[] = [];
    playlist.items.forEach((item, index) => {
      if (!item.title) {
        return;
      }
      const ranges = matchRanges(item.title, terms);
      if (!ranges) {
        return;
      }
      if (shown >= limit) {
        omitted += 1;
        return;
      }
      shown += 1;
      hits.push({ item, index, ranges });
    });
    if (hits.length > 0) {
      groups.push({ playlist, hits });
    }
  }
  return { groups, omitted };
}
