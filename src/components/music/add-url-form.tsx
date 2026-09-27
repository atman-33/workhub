import { useEffect, useMemo, useState } from "react";
import { ListPlus, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { t as tStatic, useT } from "@/lib/i18n";
import { extractVideoId } from "@/lib/music/playlist-helpers";
import { extractPlaylistId, hasPlaylistParam } from "@/lib/music/playlist-import";
import { useMusicStore } from "@/stores/music";
import { usePlaylistImport } from "./use-playlist-import";

const NOTICE_TIMEOUT_MS = 4000;

export function AddUrlForm() {
  const t = useT();
  const [inputUrl, setInputUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isChoosing, setIsChoosing] = useState(false);
  const addToPlaylist = useMusicStore((state) => state.addToPlaylist);

  const clearInput = () => {
    setInputUrl("");
    setIsChoosing(false);
  };

  const {
    state: importState,
    readPlaylist,
    confirmImport,
    reset: resetImport,
  } = usePlaylistImport((added) => {
    setNotice(tStatic("music.addUrl.added", { count: added }));
    clearInput();
  });

  // The confirmation is a transient acknowledgement, not a status line: clear
  // it on its own instead of leaving it under the input until the next edit.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const videoId = useMemo(() => extractVideoId(inputUrl), [inputUrl]);
  const playlistId = useMemo(() => extractPlaylistId(inputUrl), [inputUrl]);
  const isBusy =
    isLoading || importState.phase === "reading" || importState.phase === "adding";

  const resetMessages = () => {
    setError(null);
    setNotice(null);
    if (importState.phase === "error" || importState.phase === "confirm") {
      resetImport();
    }
  };

  const addSingleVideo = async (id: string) => {
    setIsLoading(true);
    let title: string;
    try {
      title = await api.fetchYoutubeTitle(id);
    } catch {
      // oEmbed lookup failed (offline, embed-disabled, ...): fall back to the id.
      title = `Video ${id.substring(0, 5)}`;
    }
    setIsLoading(false);

    if (addToPlaylist({ id, title })) {
      clearInput();
    } else {
      setError(t("music.addUrl.alreadyInPlaylist"));
    }
  };

  const startImport = (id: string) => {
    setIsChoosing(false);
    void readPlaylist(id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!inputUrl.trim() || isBusy) {
      if (!inputUrl.trim()) {
        setError(t("music.addUrl.enterUrl"));
      }
      return;
    }

    // A URL can carry both a video and a playlist; let the user pick which one
    // they meant rather than guessing.
    if (playlistId && videoId) {
      setIsChoosing(true);
      return;
    }
    if (playlistId) {
      startImport(playlistId);
      return;
    }
    if (videoId) {
      await addSingleVideo(videoId);
      return;
    }
    setError(
      hasPlaylistParam(inputUrl)
        ? t("music.addUrl.playlistUnsupported")
        : t("music.addUrl.invalidUrl"),
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type="text"
            value={inputUrl}
            onChange={(e) => {
              setInputUrl(e.target.value);
              setIsChoosing(false);
              resetMessages();
            }}
            placeholder={t("music.addUrl.placeholder")}
            className="h-8 pr-8 text-xs"
            disabled={isBusy}
            aria-invalid={error || importState.phase === "error" ? "true" : "false"}
          />
          {inputUrl && (
            <button
              type="button"
              onClick={() => {
                clearInput();
                resetMessages();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={isBusy}
              aria-label={t("music.addUrl.clearInput")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={isBusy}>
          {isBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : playlistId && !videoId ? (
            <ListPlus className="size-4" />
          ) : (
            <Plus className="size-4" />
          )}
          {playlistId && !videoId ? t("music.addUrl.import") : t("music.addUrl.add")}
        </Button>
      </div>

      {isChoosing && videoId && playlistId && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("music.addUrl.hasBoth")}</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void addSingleVideo(videoId)}>
            {t("music.addUrl.addThisVideo")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => startImport(playlistId)}>
            {t("music.addUrl.importPlaylist")}
          </Button>
        </div>
      )}

      {importState.phase === "reading" && (
        <p className="text-xs text-muted-foreground">{t("music.addUrl.reading")}</p>
      )}

      {importState.phase === "adding" && (
        <p className="text-xs text-muted-foreground">
          {t("music.addUrl.fetchingTitles", { done: importState.done, total: importState.total })}
        </p>
      )}

      {importState.phase === "confirm" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {importState.newIds.length === 0 ? (
            <>
              <span className="text-muted-foreground">{t("music.addUrl.allDuplicates")}</span>
              <Button type="button" size="sm" variant="secondary" onClick={resetImport}>
                {t("music.addUrl.ok")}
              </Button>
            </>
          ) : (
            <>
              <span className="text-muted-foreground">
                {importState.duplicates > 0
                  ? t("music.addUrl.newVideosWithDuplicates", {
                      count: importState.newIds.length,
                      duplicates: importState.duplicates,
                    })
                  : t("music.addUrl.newVideos", { count: importState.newIds.length })}
                {importState.truncated && ` ${t("music.addUrl.truncatedNotice")}`}
              </span>
              <Button type="button" size="sm" onClick={() => void confirmImport()}>
                {t("music.addUrl.addThem")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={resetImport}>
                {t("common.cancel")}
              </Button>
            </>
          )}
        </div>
      )}

      {importState.phase === "error" && (
        <p className="text-xs text-destructive">{importState.message}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
    </form>
  );
}
