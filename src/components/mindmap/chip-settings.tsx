import { useState } from "react";
import { ChevronDown, ChevronUp, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Which attribute chips are drawn, and in what order (the note's
 * `attr_chips`).
 *
 * A popover rather than another toolbar select, and rather than more sidebar:
 * this is a question asked once in a while and then left alone, and it is
 * about the whole map rather than about whichever node happens to be selected.
 *
 * Order and visibility are edited together because they are one setting —
 * `attr_chips` is a list, and a list answers both. Alphabetical is only what a
 * map falls back to when nobody has said otherwise, and it is a poor default
 * on purpose-built vocabularies: `tags` sorts last because of how it is
 * spelled, not because it matters least.
 */

interface Props {
  /** Every attribute key used in the map, alphabetical. */
  keys: string[];
  /** The note's current setting. */
  chips: "all" | string[];
  disabled?: boolean;
  onChange: (chips: "all" | string[]) => void;
}

export function ChipSettings({ keys, chips, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);

  // A key listed in the note but no longer used anywhere in the map is dropped
  // from the display. It stays in the file until the user changes something
  // here, at which point the list is rewritten to what the map actually has —
  // a repair rather than a loss, since a key with no values draws nothing.
  const visible = chips === "all" ? keys : chips.filter((k) => keys.includes(k));
  const hidden = keys.filter((k) => !visible.includes(k));
  const showing = visible.length > 0;

  /** Collapses an explicit list back to `"all"` when it says the same thing,
   * so the frontmatter only carries the setting once it differs. */
  const commit = (next: string[]) => {
    const isDefault = next.length === keys.length && next.every((k, i) => k === keys[i]);
    onChange(isDefault ? "all" : next);
  };

  const toggle = (key: string) =>
    commit(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);

  const move = (key: string, by: -1 | 1) => {
    const at = visible.indexOf(key);
    const to = at + by;
    if (at === -1 || to < 0 || to >= visible.length) return;
    const next = [...visible];
    [next[at], next[to]] = [next[to], next[at]];
    commit(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint
        label={
          showing
            ? `Attribute chips: ${visible.join(", ")}`
            : "Attribute chips are hidden on this map"
        }
        disabled={disabled}
      >
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={showing ? "secondary" : "outline"}
            className="h-7 text-xs"
            disabled={disabled}
          >
            <Tags className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-60 space-y-2 p-3 text-xs" align="start">
        <div className="text-[11px] text-muted-foreground">Chips, in drawing order</div>

        {visible.map((key, i) => (
          <div key={key} className="flex items-center gap-1.5">
            <Checkbox checked disabled={disabled} onCheckedChange={() => toggle(key)} />
            <span className="flex-1 truncate font-mono text-[11px]">{key}</span>
            <Button
              size="sm"
              variant="ghost"
              className="size-6 p-0"
              disabled={disabled || i === 0}
              aria-label={`Move ${key} up`}
              onClick={() => move(key, -1)}
            >
              <ChevronUp className="size-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="size-6 p-0"
              disabled={disabled || i === visible.length - 1}
              aria-label={`Move ${key} down`}
              onClick={() => move(key, 1)}
            >
              <ChevronDown className="size-3" />
            </Button>
          </div>
        ))}

        {hidden.length > 0 && (
          <>
            <div className="border-t pt-2 text-[11px] text-muted-foreground">Hidden</div>
            {hidden.map((key) => (
              <div key={key} className="flex items-center gap-1.5">
                <Checkbox
                  checked={false}
                  disabled={disabled}
                  onCheckedChange={() => toggle(key)}
                />
                <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                  {key}
                </span>
              </div>
            ))}
          </>
        )}

        <div className="flex gap-1.5 border-t pt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 flex-1 px-2 text-[11px]"
            disabled={disabled || chips === "all"}
            onClick={() => onChange("all")}
          >
            Show all
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 flex-1 px-2 text-[11px]"
            disabled={disabled || !showing}
            onClick={() => onChange([])}
          >
            Hide all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
