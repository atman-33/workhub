---
paths:
  - "src/components/music/**"
  - "src/stores/music/**"
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
