// Clips tab: the snippet list behind the clibor-style picker (double-tap Ctrl
// anywhere in Windows to pop it up and paste into the app you were typing in).
// Snippets live in `~/.workhub/clips.json` (src-tauri/src/clips/store.rs); the
// gesture settings live in the app config alongside the other input features.
//
// The gesture toggle sits here rather than in the Settings dialog because
// this list is configured rarely and in one sitting — keeping the switch next
// to the thing it switches on saves hunting for it in two places.
import { useCallback, useEffect, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ClipboardList, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Clip, Config } from "@/types";

const GESTURES = [
  { value: "ctrl-double", label: "Double-tap Ctrl" },
  { value: "shift-double", label: "Double-tap Shift" },
  { value: "off", label: "Off" },
];

function newClip(): Clip {
  return { id: `c${Date.now().toString(36)}`, label: "", text: "" };
}

function SortableClip({
  clip,
  index,
  onPatch,
  onDelete,
}: {
  clip: Clip;
  index: number;
  onPatch: (id: string, patch: Partial<Clip>) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: clip.id });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1000 : 0,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        "flex items-start gap-2 rounded-md border p-2",
        isDragging && "ring-2 ring-primary/50",
      )}
      {...attributes}
    >
      <button
        type="button"
        className={cn(
          "mt-1 text-muted-foreground hover:text-foreground",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
        {...listeners}
      >
        <GripVertical className="size-4" />
        <span className="sr-only">Drag to reorder</span>
      </button>
      <span className="mt-1.5 w-4 shrink-0 text-[11px] text-muted-foreground">
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Input
          value={clip.label}
          onChange={(e) => onPatch(clip.id, { label: e.target.value })}
          placeholder="Label (optional — the first line is used when empty)"
          className="h-8 text-xs"
        />
        <Textarea
          value={clip.text}
          onChange={(e) => onPatch(clip.id, { text: e.target.value })}
          placeholder="Text to paste"
          className="min-h-16 text-xs"
        />
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={() => onDelete(clip.id)}
        aria-label="Delete snippet"
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </li>
  );
}

export function ClipsView({ configVersion }: { configVersion: number }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor));

  useEffect(() => {
    void (async () => {
      const [list, cfg] = await Promise.all([api.clipsList(), api.getConfig()]);
      setClips(list);
      setConfig(cfg);
      setDirty(false);
      setLoading(false);
    })();
  }, [configVersion]);

  const patch = useCallback((id: string, patch: Partial<Clip>) => {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setDirty(true);
  }, []);

  const remove = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
    setDirty(true);
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setClips((prev) => {
      const from = prev.findIndex((c) => c.id === active.id);
      const to = prev.findIndex((c) => c.id === over.id);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // Empty snippets would show up in the picker as unpickable blanks.
      const kept = clips.filter((c) => c.text.trim() || c.label.trim());
      await api.clipsSave(kept);
      setClips(kept);
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  /** Gesture settings save immediately — there is nothing to review. */
  const patchSettings = async (patch: Partial<Config["settings"]>) => {
    if (!config) return;
    const next = { ...config, settings: { ...config.settings, ...patch } };
    setConfig(next);
    try {
      await api.saveConfig(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const enabled = config?.settings.clips_enabled ?? true;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-2">
        <ClipboardList className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Clips</h2>
        <span className="text-xs text-muted-foreground">
          Snippets you can paste into any app without leaving the keyboard
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border p-3">
        <Switch
          checked={enabled}
          disabled={!config}
          onCheckedChange={(v) => void patchSettings({ clips_enabled: v })}
        />
        <span className="text-xs">Enable the picker</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Gesture</span>
          <Select
            value={config?.settings.clips_gesture ?? "ctrl-double"}
            disabled={!config || !enabled}
            onValueChange={(v) => void patchSettings({ clips_gesture: v })}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GESTURES.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Tap the modifier twice on its own — a tap that is part of a shortcut
          (Ctrl+C and friends) never opens the picker. Alt is reserved for the
          ink overlay.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setClips((prev) => [...prev, newClip()]);
            setDirty(true);
          }}
        >
          <Plus className="size-3.5" />
          Add snippet
        </Button>
        <Button size="xs" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {dirty && (
          <span className="text-[11px] text-muted-foreground">
            Unsaved changes
          </span>
        )}
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : clips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No snippets yet. Add the phrases you retype the most — addresses,
            boilerplate replies, commands — then double-tap Ctrl anywhere to
            paste one.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={clips.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {clips.map((clip, index) => (
                  <SortableClip
                    key={clip.id}
                    clip={clip}
                    index={index}
                    onPatch={patch}
                    onDelete={remove}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
