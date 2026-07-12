import { useCallback, useEffect, useRef } from "react";
import { useMusicStore } from "@/stores/music";
import type { YouTubePlayerLike } from "@/stores/music/types";

interface YouTubePlayerEvent {
  target: YouTubePlayerLike;
  data: number;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: {
      Player: new (
        elementId: string,
        options: {
          events: {
            onReady: (event: YouTubePlayerEvent) => void;
            onStateChange: (event: YouTubePlayerEvent) => void;
          };
        },
      ) => YouTubePlayerLike;
      PlayerState: {
        ENDED: number;
      };
    };
  }
}

/**
 * Creates a YouTube IFrame API player on the element with the given id and
 * wires its lifecycle into the music store (advance on ENDED, respecting
 * loop/shuffle mode).
 */
export const useYouTubePlayer = (elementId: string) => {
  const playerRef = useRef<YouTubePlayerLike | null>(null);
  const { setPlayerInstance, playNext, currentVideoId, loopMode, play, setPlayingStateToFalse } =
    useMusicStore();
  const isReadyRef = useRef(false);

  // Keeps the latest state/actions reachable from the stable event handlers.
  const stateRef = useRef({ playNext, loopMode, currentVideoId, play, setPlayingStateToFalse });

  useEffect(() => {
    stateRef.current = { playNext, loopMode, currentVideoId, play, setPlayingStateToFalse };
  }, [playNext, loopMode, currentVideoId, play, setPlayingStateToFalse]);

  const handlePlayerReady = useCallback((event: YouTubePlayerEvent) => {
    isReadyRef.current = true;
    const videoId = stateRef.current.currentVideoId;
    if (videoId) {
      event.target.cueVideoById(videoId);
    }
  }, []);

  const handleStateChange = useCallback((event: YouTubePlayerEvent) => {
    if (event.data === window.YT.PlayerState.ENDED) {
      const { loopMode, currentVideoId, play, playNext } = stateRef.current;
      if (loopMode === "one" && currentVideoId) {
        play(currentVideoId);
      } else if (loopMode === "all") {
        playNext();
      } else {
        stateRef.current.setPlayingStateToFalse();
      }
    }
  }, []);

  useEffect(() => {
    const createPlayer = () => {
      playerRef.current = new window.YT.Player(elementId, {
        events: {
          onReady: handlePlayerReady,
          onStateChange: handleStateChange,
        },
      });
      setPlayerInstance(playerRef.current);
    };

    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = createPlayer;
    } else {
      createPlayer();
    }

    return () => {
      isReadyRef.current = false;
      if (playerRef.current) {
        playerRef.current.destroy?.();
        playerRef.current = null;
      }
    };
  }, [elementId, setPlayerInstance, handlePlayerReady, handleStateChange]);

  // Cue the current video once the player is ready and an id arrives from async
  // vault hydration (the persisted "resume here" track, loaded but paused).
  //
  // Guard against clobbering active playback: play()/playNext() already
  // load+play the next video and set isPlaying=true, so a cue here would stop
  // the freshly-started song — the reported "switches track but doesn't play"
  // bug. Only cue when idle. isPlaying is read via getState() rather than as an
  // effect dependency so pause/resume (which keep currentVideoId unchanged)
  // never re-cue and restart the track from the beginning.
  useEffect(() => {
    if (!isReadyRef.current || !playerRef.current || !currentVideoId) return;
    if (useMusicStore.getState().isPlaying) return;
    playerRef.current.cueVideoById(currentVideoId);
  }, [currentVideoId]);

  return playerRef;
};
