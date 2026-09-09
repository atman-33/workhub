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
 * Edits one document root: what it is called, and where it is.
 *
 * The two were separate controls, which made editing a root feel like two
 * unrelated operations — rename here, re-point there.
 */
export function DocsRootDialog({ root, onSaved, onClose }: Props) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // A closed dialog keeps its content mounted in this app (see
  // .claude/rules/radix-dialog-lifecycle.md), so the fields are seeded from
  // the root rather than from a first render that may never happen again.
  useEffect(() => {
    if (!root) return;
    setName(root.name);
    setPath(root.path);
    setError("");
  }, [root]);

  const browse = async () => {
    const picked = await pickFolder({
      directory: true,
      multiple: false,
      title: "Pick the folder",
    });
    if (typeof picked === "string") setPath(picked.replaceAll("\\", "/"));
  };

  const save = async () => {
    if (!root) return;
    setSaving(true);
    try {
      onSaved(await api.updateDocsRoot(root.id, name, path));
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
            The folder is recorded in the vault, so another PC that clones it gets this folder too.
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
              placeholder="Team share"
              className="h-8"
            />
            <p className="text-muted-foreground">
              A label for the picker. Leave it empty to show the path instead.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="docs-root-path" className="font-medium">
              Folder
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
                  aria-label="Browse for the folder"
                  onClick={() => void browse()}
                >
                  <FolderOpen />
                </Button>
              </Hint>
            </div>
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
