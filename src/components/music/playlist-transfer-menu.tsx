import { useEffect, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { Download, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { api } from "@/lib/api";
import { t as tStatic, useT } from "@/lib/i18n";
import { parsePlaylistTransfer, serializePlaylists } from "@/lib/music/playlist-transfer";
import type { Playlist } from "@/lib/music/types";
import { useMusicStore } from "@/stores/music";

const STATUS_CLEAR_MS = 4000;
const JSON_FILTER = [{ name: "Playlist export", extensions: ["json"] }];

/** Trims a playlist name down to something safe for a filename. */
const toFileStem = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .slice(0, 60) || "playlists";

// The lib throws these constant English messages verbatim (kept English so
// its own tests can match them by regex); translate them for display only.
const NEWER_VERSION_RE =
  /^This export was made by a newer version of workhub \(format v(.+)\)\.$/;

const errorText = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Not a workhub playlist export.") {
    return tStatic("music.transfer.notWorkhubExport");
  }
  if (message === "The file contains no playlists.") {
    return tStatic("music.transfer.noPlaylists");
  }
  const versionMatch = NEWER_VERSION_RE.exec(message);
  if (versionMatch) {
    return tStatic("music.transfer.newerVersion", { version: versionMatch[1] });
  }
  return message;
};

/**
 * Export/import of playlists so a library can be reproduced on another workhub
 * install — via a JSON file, or via the clipboard for quick sharing.
 */
export function PlaylistTransferMenu() {
  const t = useT();
  const playlists = useMusicStore((state) => state.playlists);
  const activePlaylistId = useMusicStore((state) => state.activePlaylistId);
  const importPlaylists = useMusicStore((state) => state.importPlaylists);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);

  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const exportToFile = async (selection: Playlist[], stem: string) => {
    try {
      const path = await saveFile({ defaultPath: `${stem}.json`, filters: JSON_FILTER });
      if (!path) return;
      await api.exportPlaylistFile(path, serializePlaylists(selection));
      setStatus({
        text: tStatic("music.transfer.exported", { count: selection.length }),
        isError: false,
      });
    } catch (error) {
      setStatus({
        text: tStatic("music.transfer.exportFailed", { error: errorText(error) }),
        isError: true,
      });
    }
  };

  const copyToClipboard = async (selection: Playlist[]) => {
    try {
      await writeText(serializePlaylists(selection));
      setStatus({
        text: tStatic("music.transfer.copied", { count: selection.length }),
        isError: false,
      });
    } catch (error) {
      setStatus({
        text: tStatic("music.transfer.copyFailed", { error: errorText(error) }),
        isError: true,
      });
    }
  };

  const applyImport = (text: string) => {
    const imported = parsePlaylistTransfer(text);
    const { added, skipped } = importPlaylists(imported);
    if (added === 0) {
      setStatus({
        text: tStatic("music.transfer.nothingImported"),
        isError: true,
      });
      return;
    }
    setStatus({
      text: skipped
        ? tStatic("music.transfer.importedWithSkipped", { added, skipped })
        : tStatic("music.transfer.imported", { added }),
      isError: false,
    });
  };

  const importFromFile = async () => {
    try {
      const path = await openFile({ multiple: false, directory: false, filters: JSON_FILTER });
      if (typeof path !== "string") return;
      applyImport(await api.importPlaylistFile(path));
    } catch (error) {
      setStatus({
        text: tStatic("music.transfer.importFailed", { error: errorText(error) }),
        isError: true,
      });
    }
  };

  const importFromClipboard = async () => {
    try {
      const text = await readText();
      if (!text?.trim()) {
        setStatus({ text: tStatic("music.transfer.clipboardEmpty"), isError: true });
        return;
      }
      applyImport(text);
    } catch (error) {
      setStatus({
        text: tStatic("music.transfer.importFailed", { error: errorText(error) }),
        isError: true,
      });
    }
  };

  const dateStem = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <Hint label={t("music.transfer.export")}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6">
              <Download className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => void exportToFile(playlists, `workhub-playlists-${dateStem}`)}
          >
            {t("music.transfer.exportAll")}
          </DropdownMenuItem>
          {activePlaylist && (
            <DropdownMenuItem
              onSelect={() => void exportToFile([activePlaylist], toFileStem(activePlaylist.name))}
            >
              {t("music.transfer.exportOne", { name: activePlaylist.name })}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyToClipboard(playlists)}>
            {t("music.transfer.copyAll")}
          </DropdownMenuItem>
          {activePlaylist && (
            <DropdownMenuItem onSelect={() => void copyToClipboard([activePlaylist])}>
              {t("music.transfer.copyOne", { name: activePlaylist.name })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <Hint label={t("music.transfer.import")}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6">
              <Upload className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void importFromFile()}>
            {t("music.transfer.importFromFile")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void importFromClipboard()}>
            {t("music.transfer.pasteClipboard")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {status && (
        <span
          className={`text-[10px] ${status.isError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {status.text}
        </span>
      )}
    </div>
  );
}
