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
import { useT } from "@/lib/i18n";

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
  const t = useT();
  const [name, setName] = useState("");
  // The slug starts as a derivation of the name; once the user edits it by
  // hand it stays put, or every further keystroke in the name would fight the
  // correction.
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The folder name the backend will actually create — `NNNN-<slug>`. Asked
  // fresh on every slug change so the dialog shows the real sort number
  // instead of guessing one client-side (T-0278).
  const [folderPreview, setFolderPreview] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setSlug("");
      setSlugEdited(false);
      setError("");
      setBusy(false);
      setFolderPreview("");
    }
  }, [open]);

  const effectiveSlug = (slugEdited ? slug : slugify(name)).trim();

  useEffect(() => {
    if (!open || !effectiveSlug) {
      setFolderPreview("");
      return;
    }
    let cancelled = false;
    api
      .nextProjectFolder(vaultPath, effectiveSlug)
      .then((folder) => {
        if (!cancelled) setFolderPreview(folder);
      })
      .catch(() => {
        if (!cancelled) setFolderPreview("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, vaultPath, effectiveSlug]);

  const folderLabel = folderPreview || `NNNN-${effectiveSlug || "<slug>"}`;

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
          <DialogTitle>{t("schedule.projectCreate.title")}</DialogTitle>
          <DialogDescription>{t("schedule.projectCreate.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              {t("schedule.projectCreate.nameLabel")}
            </span>
            <Input
              value={name}
              autoFocus
              placeholder={t("schedule.projectCreate.namePlaceholder")}
              className="h-8 text-sm"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              {t("schedule.projectCreate.slugLabel", { folder: folderLabel })}
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
            {t("schedule.projectCreate.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
