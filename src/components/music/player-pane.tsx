import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMusicStore } from "@/stores/music";
import { useYouTubePlayer } from "./use-youtube-player";

const PLAYER_ELEMENT_ID = "workhub-youtube-player";

export function PlayerPane() {
  const {
    isPlaying,
    currentVideoId,
    loopMode,
    isShuffle,
    pause,
    resume,
    toggleLoop,
    toggleShuffle,
    playNext,
    playPrevious,
    getActivePlaylist,
  } = useMusicStore();
  useYouTubePlayer(PLAYER_ELEMENT_ID);

  const activePlaylist = getActivePlaylist();
  const currentVideoTitle =
    currentVideoId && activePlaylist
      ? (activePlaylist.items.find((item) => item.id === currentVideoId)?.title ??
        `Video ${currentVideoId.substring(0, 5)}`)
      : null;

  return (
    <div className="flex flex-col gap-3">
      {/* The IFrame API replaces the inner div with an iframe (same id). */}
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black shadow-md [&>iframe]:h-full [&>iframe]:w-full">
        <div id={PLAYER_ELEMENT_ID} />
      </div>
      <div className="flex h-8 items-center justify-center px-2 text-center text-sm font-medium">
        {currentVideoTitle ? (
          <span className="truncate">{currentVideoTitle}</span>
        ) : (
          <span className="text-muted-foreground">Select a video to start playing</span>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="icon" onClick={playPrevious} disabled={!currentVideoId}>
          <SkipBack className="size-4" />
          <span className="sr-only">Previous</span>
        </Button>
        <Button
          onClick={() => (isPlaying ? pause() : resume())}
          disabled={!currentVideoId}
          className="px-6"
        >
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          {isPlaying ? "Pause" : "Play"}
        </Button>
        <Button variant="ghost" size="icon" onClick={playNext} disabled={!currentVideoId}>
          <SkipForward className="size-4" />
          <span className="sr-only">Next</span>
        </Button>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={toggleLoop} className="gap-1.5">
          {loopMode === "one" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
          {loopMode === "all" ? "Loop ALL" : "Loop ONE"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleShuffle}
          className={cn("gap-1.5", isShuffle && "bg-accent text-accent-foreground")}
        >
          <Shuffle className="size-4" />
          Shuffle {isShuffle ? "ON" : "OFF"}
        </Button>
      </div>
    </div>
  );
}
