import { useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { DocsRootDialog } from "@/components/docs/docs-root-dialog";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
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
  const [editing, setEditing] = useState<DocsRootStatus | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const selected = roots.find((r) => r.id === selectedId);

  const add = async () => {
    const picked = await pickFolder({
      directory: true,
      multiple: false,
      title: "Add a document folder",
    });
    if (typeof picked !== "string") return;
    try {
      onRootsChanged(await api.addDocsRoot(picked.replaceAll("\\", "/"), ""));
      onError("");
    } catch (e) {
      onError(String(e));
    }
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

      <Hint label="Register a folder to browse">
        <Button size="icon-sm" variant="ghost" aria-label="Add folder" onClick={() => void add()}>
          <FolderPlus />
        </Button>
      </Hint>
      <Hint label="Edit this folder's name and paths" disabled={!selected}>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Edit folder"
          disabled={!selected}
          onClick={() => setEditing(selected ?? null)}
        >
          <Pencil />
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

      {selected?.overridden && (
        <Hint label={`Shared path: ${selected.path}`}>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            local path
          </span>
        </Hint>
      )}

      <DocsRootDialog
        root={editing}
        onSaved={(list) => {
          onRootsChanged(list);
          onError("");
        }}
        onClose={() => setEditing(null)}
      />

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
          if (selected) {
            void api
              .removeDocsRoot(selected.id)
              .then((list) => {
                onRootsChanged(list);
                onError("");
              })
              .catch((e) => onError(String(e)));
          }
          setConfirmRemove(false);
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}
