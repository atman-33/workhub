import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  /** Allow committing free-text that is not in `options` (e.g. an arbitrary
   * repo name or model id). */
  allowCustom?: boolean;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Render the popover as its own modal layer. Needed when the combobox lives
   * inside a modal Radix Dialog/Sheet — otherwise the parent's scroll-lock and
   * pointer-events guard swallow wheel and click on the portaled popup.
   */
  modal?: boolean;
  /**
   * Options surfaced at the top of the dropdown in a separate "Recent" group,
   * above the main `options`. Used for recently-used models / pinned entries.
   * Duplicates with `options` are deduped automatically (recent wins).
   */
  leadingOptions?: string[];
  /** Heading for the `leadingOptions` group (defaults to "Recent"). */
  leadingHeading?: string;
  /**
   * When true, the dropdown renders a spinner with "Loading…" instead of an
   * empty list — making a pending async fetch visible while the popover is
   * open. Has no effect once `options` or `leadingOptions` are non-empty.
   */
  loading?: boolean;
}

/**
 * An editable combobox: pick from `options` or, when `allowCustom` is set, type
 * and commit an arbitrary value. Replaces the native `<input list>` datalist so
 * the control matches the rest of the shadcn/ui surface.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowCustom = false,
  emptyText = "No results.",
  disabled = false,
  className,
  modal = false,
  leadingOptions = [],
  leadingHeading = "Recent",
  loading = false,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const commit = (next: string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  const trimmed = query.trim();
  const showCustom =
    allowCustom &&
    trimmed.length > 0 &&
    ![...leadingOptions, ...options].some(
      (o) => o.toLowerCase() === trimmed.toLowerCase(),
    );

  // Dedupe: drop any leading option that also appears in the main list so it
  // is not rendered twice. Leading wins (kept at top, removed from the tail).
  const leadingLower = new Set(leadingOptions.map((o) => o.toLowerCase()));
  const dedupedOptions = options.filter((o) => !leadingLower.has(o.toLowerCase()));

  return (
    <Popover
      modal={modal}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-8 w-full justify-between px-2 text-xs font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder={placeholder}
            className="h-8 text-xs"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {!showCustom && (
              <CommandEmpty>
                <span className="inline-flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
                  {loading && (
                    <Loader2 className="size-3.5 animate-spin opacity-70" />
                  )}
                  {loading ? "Loading…" : emptyText}
                </span>
              </CommandEmpty>
            )}
            {leadingOptions.length > 0 && (
              <CommandGroup heading={leadingHeading}>
                {leadingOptions.map((option) => (
                  <CommandItem key={option} value={option} onSelect={() => commit(option)}>
                    <CheckIcon
                      className={cn(
                        "size-3.5",
                        value === option ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup>
              {dedupedOptions.map((option) => (
                <CommandItem key={option} value={option} onSelect={() => commit(option)}>
                  <CheckIcon
                    className={cn(
                      "size-3.5",
                      value === option ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option}
                </CommandItem>
              ))}
              {showCustom && (
                <CommandItem value={trimmed} onSelect={() => commit(trimmed)}>
                  <CheckIcon className="size-3.5 opacity-0" />
                  Use “{trimmed}”
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
