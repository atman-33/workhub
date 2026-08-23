import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

/**
 * Derives a folder slug from a display name — the vault's folder convention
 * is lowercase kebab-case ASCII. A name with no ASCII letters or digits at
 * all (e.g. a Japanese name) derives to nothing; the slug is then typed by
 * hand.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Props {
  vaultPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new slug once the scaffold is on disk. */
  onCreated: (slug: string) => void;
}

/**
 * Creates a vault project (`projects/<slug>/`) from the bundled scaffold
 * (T-0178). Opened from the project dropdown's "New project…" entry and from
 * the empty state shown while the vault has no projects at all — until this
 * existed, that empty state was a dead end.
 */
export function ProjectCreateDialog({ vaultPath, open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  // The slug starts as a derivation of the name; once the user edits it by
  // hand it stays put, or every further keystroke in the name would fight the
  // correction.
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setSlug("");
      setSlugEdited(false);
      setError("");
      setBusy(false);
    }
  }, [open]);

  const effectiveSlug = (slugEdited ? slug : slugify(name)).trim();

  const create = async () => {
    if (!effectiveSlug || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.createVaultProject(vaultPath, effectiveSlug, name.trim());
      onOpenChange(false);
      onCreated(effectiveSlug);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A schedule lives inside a project — a folder under the vault at
            projects/&lt;slug&gt;/. This creates the folder from the bundled
            scaffold (README, prd, roadmap, …).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Project name</span>
            <Input
              value={name}
              autoFocus
              placeholder="e.g. My web app"
              className="h-8 text-sm"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              Folder — projects/&lt;slug&gt;/ (lowercase, kebab-case)
            </span>
            <Input
              value={effectiveSlug}
              placeholder="my-web-app"
              className="h-8 font-mono text-xs"
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
            />
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!effectiveSlug || busy} onClick={() => void create()}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
