import { useState } from "react";
import { ArrowUpCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { UpdateInfo } from "@/types";

type Phase = "available" | "downloading" | "ready" | "failed";

interface Props {
  update: UpdateInfo;
  currentVersion: string;
  onDismiss: () => void;
}

export function UpdateBanner({ update, currentVersion, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>("available");
  const [error, setError] = useState("");

  const start = async () => {
    setPhase("downloading");
    try {
      await api.applyUpdate(update.url);
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("failed");
    }
  };

  return (
    <div className="flex h-10 items-center gap-3 bg-primary px-4 text-[13px] text-primary-foreground">
      <ArrowUpCircle className="size-4 shrink-0" />
      {phase === "available" && (
        <>
          <span className="font-medium">
            New version {update.tag} is available (current v{currentVersion})
          </span>
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={start}>
            Update & restart
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs hover:bg-white/10"
            onClick={onDismiss}
          >
            Later
          </Button>
        </>
      )}
      {phase === "downloading" && (
        <>
          <Loader2 className="size-4 animate-spin" />
          <span>downloading {update.tag}…</span>
        </>
      )}
      {phase === "ready" && (
        <>
          <span className="font-medium">✓ Update installed</span>
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs"
            onClick={() => api.restartApp()}
          >
            Restart now
          </Button>
        </>
      )}
      {phase === "failed" && (
        <>
          <span className="truncate">update failed: {error}</span>
          <Button size="icon" variant="ghost" className="size-6 hover:bg-white/10" onClick={onDismiss}>
            <X className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}
