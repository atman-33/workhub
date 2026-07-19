// Quick-capture window (label `quick-capture`): a small always-on-top form
// that turns a copied link into an inbox task. Shown/hidden by the Rust side
// (src-tauri/src/quick_capture.rs); each `quick-capture://activate` event
// re-reads the clipboard and re-initializes the form. Only clipboard content
// matching a known capture pattern (lib/capture-patterns.ts) is auto-pasted;
// anything else waits behind the paste button.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { ClipboardPaste, Inbox, X } from "lucide-react";
import { api } from "@/lib/api";
import { matchCapturePatterns, shouldAutoPaste } from "@/lib/capture-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

async function notifyCreated(id: string, title: string) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  sendNotification({ title: `Task created: ${id}`, body: title });
}

export function CaptureApp() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /** Clipboard text held back by the long-content guard, pasted on demand. */
  const [pendingClipboard, setPendingClipboard] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  /** Recognized sources in the current description — drives both the header
   *  badges and the tags the task is saved with. */
  const matched = matchCapturePatterns(description);

  const init = useCallback(async () => {
    setTitle("");
    setSaving(false);
    setError("");
    const clip = (await readText().catch(() => "")) ?? "";
    if (shouldAutoPaste(clip)) {
      setDescription(clip);
      setPendingClipboard("");
    } else {
      setDescription("");
      setPendingClipboard(clip);
    }
    setVaultPath((await api.getConfig()).settings.vault_path);
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    void init();
    const unlisten = listen("quick-capture://activate", () => void init());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [init]);

  const hide = () => void invoke("quick_capture_hide");

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    if (!vaultPath) {
      setError("Tasks vault is not configured — set it in workhub Settings.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const task = await api.createTask(vaultPath, {
        title: trimmed,
        status: "inbox",
        assignee: "me",
        tags: matched.map((p) => p.id),
        body: `\n## Description\n\n${description.trim()}\n\n## Results\n`,
      });
      void notifyCreated(task.id, task.title);
      hide();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
      }}
    >
      {/* Whole-header drag via startDragging(): the `data-tauri-drag-region`
          attribute only fires when the element directly under the cursor has
          it, so the icon/text/badge children would be dead zones. */}
      <header
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button")) return;
          getCurrentWindow().startDragging().catch(console.error);
        }}
        className="flex cursor-move select-none items-center justify-between border-b px-3 py-2"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Inbox className="size-3.5" />
          Quick capture
          {matched.map((p) => (
            <Badge key={p.id} variant="secondary">
              {p.id}
            </Badge>
          ))}
        </span>
        <Button size="icon-sm" variant="ghost" onClick={hide} aria-label="Close">
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3">
        <Input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="h-8"
        />
        <div className="relative flex-1">
          <Textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (a copied Slack / PR / monday link is pasted here)"
            className="h-full resize-none pr-8 font-mono text-xs"
          />
          {description && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="absolute right-1 top-1"
              aria-label="Clear description"
              onClick={() => {
                setDescription("");
                descriptionRef.current?.focus();
              }}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        {pendingClipboard && (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => {
              setDescription(pendingClipboard);
              setPendingClipboard("");
            }}
          >
            <ClipboardPaste className="mr-1.5 size-3.5" />
            Paste clipboard ({pendingClipboard.length.toLocaleString()} chars)
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Ctrl+Enter to save · Esc to close
          </span>
          <Button size="sm" onClick={() => void save()} disabled={!title.trim() || saving}>
            {saving ? "Saving…" : "Save to inbox"}
          </Button>
        </div>
      </div>
    </div>
  );
}
