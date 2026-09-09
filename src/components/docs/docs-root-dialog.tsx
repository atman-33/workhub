import { useEffect, useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { DocsRootStatus } from "@/types";

interface Props {
  /** The root being edited; `null` closes the dialog. */
  root: DocsRootStatus | null;
  onSaved: (roots: DocsRootStatus[]) => void;
  onClose: () => void;
}

/**
 * Edits everything about one document root in a single place.
 *
 * The name, the shared path and this machine's override used to be three
 * separate controls, which made the override read as an unrelated feature
 * rather than as the other half of the path. Seen side by side, the pair
 * explains itself: one line is what the team agreed on, the other is where
 * that folder happens to live on this PC.
 */
export function DocsRootDialog({ root, onSaved, onClose }: Props) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // A closed dialog keeps its content mounted in this app (see
  // .claude/rules/radix-dialog-lifecycle.md), so the fields are seeded from
  // the root rather than from a first render that may never happen again.
  useEffect(() => {
    if (!root) return;
    setName(root.name);
    setPath(root.path);
    setLocalPath(root.overridden ? root.effective_path : "");
    setError("");
  }, [root]);

  const browse = async (title: string, onPicked: (folder: string) => void) => {
    const picked = await pickFolder({ directory: true, multiple: false, title });
    if (typeof picked === "string") onPicked(picked.replaceAll("\\", "/"));
  };

  const save = async () => {
    if (!root) return;
    setSaving(true);
    try {
      onSaved(await api.updateDocsRoot(root.id, name, path, localPath));
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={root !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit folder</DialogTitle>
          <DialogDescription>
            The shared path travels with the vault; the path for this PC stays on this machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label htmlFor="docs-root-name" className="font-medium">
              Name
            </label>
            <Input
              id="docs-root-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={path || "shown in the folder picker"}
              className="h-8"
            />
            <p className="text-muted-foreground">Leave it empty to show the path instead.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="docs-root-path" className="font-medium">
              Shared folder
            </label>
            <div className="flex gap-1.5">
              <Input
                id="docs-root-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="G:/shared drives/team/docs"
                className="h-8 font-mono"
              />
              <Hint label="Pick a folder">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Browse for the shared folder"
                  onClick={() => void browse("Pick the shared folder", setPath)}
                >
                  <FolderOpen />
                </Button>
              </Hint>
            </div>
            <p className="text-muted-foreground">
              Stored in the vault, so another PC that clones it gets this folder too.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="docs-root-local" className="font-medium">
              Path on this PC <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <div className="flex gap-1.5">
              <Input
                id="docs-root-local"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="only when this PC mounts it somewhere else"
                className="h-8 font-mono"
              />
              <Hint label="Pick where it is on this PC">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Browse for the local mount"
                  onClick={() => void browse("Where is it on this PC?", setLocalPath)}
                >
                  <FolderOpen />
                </Button>
              </Hint>
            </div>
            <p className="text-muted-foreground">
              Kept on this machine only. Empty means the shared path is used as it is.
            </p>
          </div>

          {error && <p className="text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || !path.trim()} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
