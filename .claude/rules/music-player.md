---
paths:
  - "src/components/music/**"
  - "src/stores/music/**"
  - "src/lib/music/**"
---

# Music player (YouTube IFrame) invariants

- **`cueVideoById` loads but does NOT play; `loadVideoById` loads AND plays.**
  Playback transitions (`play`, `playNext`, `playPrevious` in
  `stores/music/playback-slice.ts`) use `loadVideoById` + `playVideo`. Only the
  passive "resume here" cue at startup uses `cueVideoById`.

- **The `currentVideoId` sync effect in `useYouTubePlayer.ts` must not cue
  during active playback.** Vault hydration is async (loaded from the vault via
  Tauri after mount), so an effect re-cues the current id once the player is
  ready. But it fires on *every* `currentVideoId` change — including track
  advances that `playNext`/`play` already load+played — and a stray
  `cueVideoById` there stops the freshly-started song (symptom: "track switches
  but doesn't play"). Guard it with `isPlaying` (read via `getState()`, never as
  an effect dependency, so pause/resume don't restart the track). This is why
  the effect deliberately diverges from tube-loop-player, whose store hydrates
  synchronously and so needs no such effect.

# Playlist import (YouTube IFrame)

- **A playlist can be enumerated with no API key and no OAuth.**
  `cuePlaylist({ listType: "playlist", list })` followed by `getPlaylist()`
  returns the video ids. This is why `playlist-import.ts` exists instead of a
  YouTube Data API client: an API key would have to be issued by every user,
  and the OAuth alternative needs `youtube.readonly` — a Google *sensitive*
  scope, unusable outside hand-registered test users until the consent screen
  passes review.

- **`getPlaylist()` returns at most 200 entries**, silently truncated with no
  flag in the response. `PLAYER_PLAYLIST_LIMIT` encodes this and the UI warns
  when a result comes back at exactly that size.

- **`RD*` mixes, `LL` (liked) and `WL` (watch later) are not enumerable** — the
  first are generated per viewer, the others need a signed-in session an
  embedded player never has. `extractPlaylistId` rejects them up front.

- **Import needs its own off-screen player.** Cueing a playlist into the visible
  player stops the current song (same cue hazard as above). The import player is
  created, read, and destroyed inside `use-playlist-import.ts`; `stopVideo()`
  after reading keeps the cued first track from ever being heard.

- **Poll `getPlaylist()`, do not wait on `onStateChange`.** The ids can arrive
  after the CUED event, and an unreadable playlist fires no terminal event at
  all — it simply never populates. One polling loop covers both, and its
  exhaustion is the "cannot read this playlist" error.

- **All players must come through `loadYouTubeIframeApi()`.** The IFrame API
  calls the single global `onYouTubeIframeAPIReady` exactly once, so two
  independent loaders would overwrite each other's callback and one player
  would never be created.
