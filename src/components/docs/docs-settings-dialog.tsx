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

/** The public PlantUML server, offered as the example rather than as a default. */
const PUBLIC_SERVER = "https://www.plantuml.com/plantuml";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save, so the open document can re-render. */
  onSaved: () => void;
}

/**
 * The Docs tab's own settings (T-0279) — today, only the PlantUML server.
 *
 * It lives on the tab rather than in the Settings dialog, like the folder list:
 * it is a setting of this feature, not of the app. Rendering is off until a
 * server is entered, because rendering means sending the diagram's source to
 * that server, and the documents here are a team's.
 */
export function DocsSettingsDialog({ open, onClose, onSaved }: Props) {
  const [server, setServer] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // A closed dialog keeps its content mounted in this app (see
  // .claude/rules/radix-dialog-lifecycle.md), so the field is re-read on open.
  useEffect(() => {
    if (!open) return;
    setError("");
    api
      .docsPlantumlServer()
      .then(setServer)
      .catch((e) => setError(String(e)));
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      await api.setDocsPlantumlServer(server);
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Docs settings</DialogTitle>
          <DialogDescription>
            Recorded in the vault, like the folder list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 text-xs">
          <label htmlFor="docs-plantuml-server" className="font-medium">
            PlantUML server
          </label>
          <Input
            id="docs-plantuml-server"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder={PUBLIC_SERVER}
            className="h-8 font-mono"
          />
          <p className="leading-relaxed text-muted-foreground">
            <span className="font-mono">```plantuml</span> blocks are drawn by this server: each
            diagram's source is sent to it and an image comes back. Leave it empty to keep them as
            code and send nothing. The public server ({PUBLIC_SERVER}) works, but it is a third
            party — for a team's documents, prefer a server your team runs.
          </p>
          {error && <p className="text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
