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
  const initialVideoIdRef = useRef(currentVideoId);

  // Keeps the latest state/actions reachable from the stable event handlers.
  const stateRef = useRef({ playNext, loopMode, currentVideoId, play, setPlayingStateToFalse });

  useEffect(() => {
    stateRef.current = { playNext, loopMode, currentVideoId, play, setPlayingStateToFalse };
  }, [playNext, loopMode, currentVideoId, play, setPlayingStateToFalse]);

  const handlePlayerReady = useCallback((event: YouTubePlayerEvent) => {
    if (initialVideoIdRef.current) {
      event.target.cueVideoById(initialVideoIdRef.current);
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
      if (playerRef.current) {
        playerRef.current.destroy?.();
        playerRef.current = null;
      }
    };
  }, [elementId, setPlayerInstance, handlePlayerReady, handleStateChange]);

  return playerRef;
};
