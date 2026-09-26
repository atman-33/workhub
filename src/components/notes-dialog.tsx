import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import type { Project } from "@/types";

interface Props {
  project: Project | null;
  onClose: () => void;
  onSave: (path: string, notes: string, tags: string) => void;
}

export function NotesDialog({ project, onClose, onSave }: Props) {
  const t = useT();
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (project) {
      setNotes(project.notes);
      setTags(project.tags);
    }
  }, [project]);

  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">
            {t("misc.notesDialog.title", { name: project?.name ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("misc.notesDialog.notes")}
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              placeholder={t("misc.notesDialog.notesPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("misc.notesDialog.tags")}
            </label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="h-8"
              placeholder={t("misc.notesDialog.tagsPlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (project) onSave(project.path, notes, tags);
              onClose();
            }}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
