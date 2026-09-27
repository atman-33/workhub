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
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** The public PlantUML server, offered as the example rather than as a default. */
const PUBLIC_SERVER = "https://www.plantuml.com/plantuml";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save, so the open document can re-render. */
  onSaved: () => void;
}

/**
 * The Docs tab's own settings (T-0279) — the sidebar layout, dot-entries,
 * remote images, and the PlantUML server.
 *
 * It lives on the tab rather than in the Settings dialog, like the folder list:
 * it is a setting of this feature, not of the app. Rendering is off until a
 * server is entered, because rendering means sending the diagram's source to
 * that server, and the documents here are a team's.
 */
export function DocsSettingsDialog({ open, onClose, onSaved }: Props) {
  const t = useT();
  const [server, setServer] = useState("");
  const [listPane, setListPane] = useState(false);
  const [remoteImages, setRemoteImages] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // A closed dialog keeps its content mounted in this app (see
  // .claude/rules/radix-dialog-lifecycle.md), so the field is re-read on open.
  useEffect(() => {
    if (!open) return;
    setError("");
    Promise.all([
      api.docsPlantumlServer(),
      api.docsListPane(),
      api.docsAllowRemoteImages(),
      api.docsShowHidden(),
    ])
      .then(([plantuml, pane, remote, hidden]) => {
        setServer(plantuml);
        setListPane(pane);
        setRemoteImages(remote);
        setShowHidden(hidden);
      })
      .catch((e) => setError(String(e)));
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      await api.setDocsPlantumlServer(server);
      await api.setDocsListPane(listPane);
      await api.setDocsAllowRemoteImages(remoteImages);
      await api.setDocsShowHidden(showHidden);
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
          <DialogTitle>{t("docs.settings.title")}</DialogTitle>
          <DialogDescription>{t("docs.settings.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 text-xs">
          <Switch
            id="docs-list-pane"
            checked={listPane}
            onCheckedChange={setListPane}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <label htmlFor="docs-list-pane" className="font-medium">
              {t("docs.settings.listPaneLabel")}
            </label>
            <p className="leading-relaxed text-muted-foreground">
              {t("docs.settings.listPaneDescription")}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 text-xs">
          <Switch
            id="docs-show-hidden"
            checked={showHidden}
            onCheckedChange={setShowHidden}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <label htmlFor="docs-show-hidden" className="font-medium">
              {t("docs.settings.showHiddenLabel")}
            </label>
            <p className="leading-relaxed text-muted-foreground">
              {t("docs.settings.showHiddenDescription")}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 text-xs">
          <Switch
            id="docs-remote-images"
            checked={remoteImages}
            onCheckedChange={setRemoteImages}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <label htmlFor="docs-remote-images" className="font-medium">
              {t("docs.settings.remoteImagesLabel")}
            </label>
            <p className="leading-relaxed text-muted-foreground">
              {t("docs.settings.remoteImagesDescription")}
            </p>
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          <label htmlFor="docs-plantuml-server" className="font-medium">
            {t("docs.settings.plantumlLabel")}
          </label>
          <Input
            id="docs-plantuml-server"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder={PUBLIC_SERVER}
            className="h-8 font-mono"
          />
          <p className="leading-relaxed text-muted-foreground">
            <span className="font-mono">```plantuml</span>{" "}
            {t("docs.settings.plantumlDescription", { server: PUBLIC_SERVER })}
          </p>
          {error && <p className="text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
