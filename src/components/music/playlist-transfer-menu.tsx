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
import { api } from "@/lib/api";
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

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Export/import of playlists so a library can be reproduced on another workhub
 * install — via a JSON file, or via the clipboard for quick sharing.
 */
export function PlaylistTransferMenu() {
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
      setStatus({ text: `Exported ${selection.length} playlist(s)`, isError: false });
    } catch (error) {
      setStatus({ text: `Export failed — ${errorText(error)}`, isError: true });
    }
  };

  const copyToClipboard = async (selection: Playlist[]) => {
    try {
      await writeText(serializePlaylists(selection));
      setStatus({ text: `Copied ${selection.length} playlist(s) as JSON`, isError: false });
    } catch (error) {
      setStatus({ text: `Copy failed — ${errorText(error)}`, isError: true });
    }
  };

  const applyImport = (text: string) => {
    const imported = parsePlaylistTransfer(text);
    const { added, skipped } = importPlaylists(imported);
    if (added === 0) {
      setStatus({
        text: "Nothing imported — the playlist limit is already reached",
        isError: true,
      });
      return;
    }
    setStatus({
      text: skipped
        ? `Imported ${added} playlist(s); skipped ${skipped} (playlist limit reached)`
        : `Imported ${added} playlist(s)`,
      isError: false,
    });
  };

  const importFromFile = async () => {
    try {
      const path = await openFile({ multiple: false, directory: false, filters: JSON_FILTER });
      if (typeof path !== "string") return;
      applyImport(await api.importPlaylistFile(path));
    } catch (error) {
      setStatus({ text: `Import failed — ${errorText(error)}`, isError: true });
    }
  };

  const importFromClipboard = async () => {
    try {
      const text = await readText();
      if (!text?.trim()) {
        setStatus({ text: "The clipboard is empty.", isError: true });
        return;
      }
      applyImport(text);
    } catch (error) {
      setStatus({ text: `Import failed — ${errorText(error)}`, isError: true });
    }
  };

  const dateStem = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-6" title="Export playlists">
            <Download className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => void exportToFile(playlists, `workhub-playlists-${dateStem}`)}
          >
            Export all playlists…
          </DropdownMenuItem>
          {activePlaylist && (
            <DropdownMenuItem
              onSelect={() => void exportToFile([activePlaylist], toFileStem(activePlaylist.name))}
            >
              Export "{activePlaylist.name}"…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyToClipboard(playlists)}>
            Copy all as JSON
          </DropdownMenuItem>
          {activePlaylist && (
            <DropdownMenuItem onSelect={() => void copyToClipboard([activePlaylist])}>
              Copy "{activePlaylist.name}" as JSON
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-6" title="Import playlists">
            <Upload className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void importFromFile()}>
            Import from file…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void importFromClipboard()}>
            Paste JSON from clipboard
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
