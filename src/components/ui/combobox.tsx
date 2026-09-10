import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  optionSearchValue,
  type ComboboxOptionDetails,
} from "@/lib/combobox-options";
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
   * Label for an entry at the top of the list that commits the empty string.
   * Without it, a combobox whose value is optional can be set but never
   * un-set — the only way back to "nothing" was free text, which is exactly
   * what `allowCustom={false}` takes away.
   */
  noneLabel?: string;
  /**
   * Heading for the main `options` group. Only rendered when `leadingOptions`
   * is non-empty, so the main list is visually separated from the Recent
   * group instead of looking like its continuation. Ignored otherwise.
   */
  mainHeading?: string;
  /**
   * When true, the dropdown renders a spinner with "Loading…" instead of an
   * empty list — making a pending async fetch visible while the popover is
   * open. Has no effect once `options` or `leadingOptions` are non-empty.
   */
  loading?: boolean;
  /**
   * Display-only decoration for the options, keyed by option value: a `label`
   * drawn beside the value and a dimmer `meta` after it. A list of bare ids
   * can only be searched by someone who already knows the ids, which is the
   * one thing a picker exists to spare you — so the decoration also feeds the
   * search text. The committed value stays the option string itself: nothing
   * here is ever parsed back into one (T-0219).
   */
  optionDetails?: ComboboxOptionDetails;
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
  noneLabel,
  mainHeading,
  loading = false,
  optionDetails,
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

  // One option row. Undecorated options render exactly as they did before the
  // decoration existed, which is what keeps `optionDetails` opt-in.
  const renderOption = (option: string) => {
    const detail = optionDetails?.[option];
    if (!detail?.label && !detail?.meta) return option;
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0">{option}</span>
        {detail.label && (
          <span className="truncate text-muted-foreground">{detail.label}</span>
        )}
        {detail.meta && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            {detail.meta}
          </span>
        )}
      </span>
    );
  };

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
            {noneLabel !== undefined && (
              <CommandItem value={noneLabel} onSelect={() => commit("")}>
                <CheckIcon
                  className={cn("size-3.5", value ? "opacity-0" : "opacity-100")}
                />
                <span className="text-muted-foreground">{noneLabel}</span>
              </CommandItem>
            )}
            {leadingOptions.length > 0 && (
              <CommandGroup heading={leadingHeading}>
                {leadingOptions.map((option) => (
                  <CommandItem
                    key={option}
                    value={optionSearchValue(option, optionDetails?.[option])}
                    onSelect={() => commit(option)}
                  >
                    <CheckIcon
                      className={cn(
                        "size-3.5",
                        value === option ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {renderOption(option)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={leadingOptions.length > 0 ? mainHeading : undefined}>
              {dedupedOptions.map((option) => (
                <CommandItem
                  key={option}
                  value={optionSearchValue(option, optionDetails?.[option])}
                  onSelect={() => commit(option)}
                >
                  <CheckIcon
                    className={cn(
                      "size-3.5",
                      value === option ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {renderOption(option)}
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
