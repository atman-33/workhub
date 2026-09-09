import { useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { FolderPlus, Pencil, Trash2, Wrench } from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { DocsRootStatus } from "@/types";

interface Props {
  roots: DocsRootStatus[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Called with the list every command returns, so the view re-renders. */
  onRootsChanged: (roots: DocsRootStatus[]) => void;
  onError: (message: string) => void;
}

/**
 * Registration and selection of document roots, in the tab itself.
 *
 * This is deliberately not in the Settings dialog: a root is the thing the
 * tab is *for*, and the owner asked to add one where they are looking at it —
 * the same way the Projects tab manages projects.
 */
export function DocsRootsBar({ roots, selectedId, onSelect, onRootsChanged, onError }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const selected = roots.find((r) => r.id === selectedId);

  const run = async (job: () => Promise<DocsRootStatus[]>) => {
    try {
      onRootsChanged(await job());
      onError("");
    } catch (e) {
      onError(String(e));
    }
  };

  const add = async () => {
    const picked = await pickFolder({
      directory: true,
      multiple: false,
      title: "Add a document folder",
    });
    if (typeof picked !== "string") return;
    await run(() => api.addDocsRoot(picked.replaceAll("\\", "/"), ""));
  };

  // Re-points a root at this machine's mount. The shared path stays as the
  // team recorded it — only this PC's override changes.
  const repoint = async () => {
    if (!selected) return;
    const picked = await pickFolder({
      directory: true,
      multiple: false,
      title: `Where is "${selected.name || selected.path}" on this PC?`,
    });
    if (typeof picked !== "string") return;
    await run(() => api.setDocsRootLocalPath(selected.id, picked.replaceAll("\\", "/")));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <Select value={selectedId} onValueChange={onSelect}>
        <SelectTrigger size="sm" className="w-[280px]">
          <SelectValue placeholder={roots.length ? "Pick a folder" : "No folders registered"} />
        </SelectTrigger>
        <SelectContent>
          {roots.map((root) => (
            <SelectItem key={root.id} value={root.id}>
              {root.name || root.path}
              {!root.available && " (not on this PC)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {renaming && selected ? (
        <>
          <Input
            autoFocus
            value={draftName}
            placeholder={selected.path}
            className="h-8 w-[220px]"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(false);
              if (e.key === "Enter") {
                void run(() => api.renameDocsRoot(selected.id, draftName)).then(() =>
                  setRenaming(false),
                );
              }
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void run(() => api.renameDocsRoot(selected.id, draftName)).then(() =>
                setRenaming(false),
              )
            }
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Hint label="Register a folder to browse">
            <Button size="icon-sm" variant="ghost" aria-label="Add folder" onClick={() => void add()}>
              <FolderPlus />
            </Button>
          </Hint>
          <Hint label="Rename this folder" disabled={!selected}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Rename folder"
              disabled={!selected}
              onClick={() => {
                setDraftName(selected?.name ?? "");
                setRenaming(true);
              }}
            >
              <Pencil />
            </Button>
          </Hint>
          <Hint
            label="Point this folder at where it is mounted on this PC"
            disabled={!selected}
          >
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Set local path"
              disabled={!selected}
              onClick={() => void repoint()}
            >
              <Wrench />
            </Button>
          </Hint>
          <Hint label="Forget this folder (nothing on the share is touched)" disabled={!selected}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remove folder"
              disabled={!selected}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 />
            </Button>
          </Hint>
        </>
      )}

      {selected?.overridden && (
        <Hint label={`Shared path: ${selected.path}`}>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            local path
          </span>
        </Hint>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove this folder?"
        description={
          selected
            ? `"${selected.name || selected.path}" is removed from the list. The folder itself and everything in it are left exactly as they are.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (selected) void run(() => api.removeDocsRoot(selected.id));
          setConfirmRemove(false);
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}
