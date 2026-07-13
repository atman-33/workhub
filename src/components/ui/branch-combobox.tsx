import * as React from "react";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface BranchComboboxProps {
  /** Repository path — the picker fetches its branches lazily on open. */
  path: string;
  /** Currently checked-out branch (gets a check mark). */
  current: string;
  /** Called with the chosen branch (local name or `remote/branch`). */
  onSwitch: (branch: string) => void;
  disabled?: boolean;
  /** Render the popover as its own modal layer (needed inside a modal Sheet). */
  modal?: boolean;
  /** Uncontrolled mode: an element to open the popover from. */
  trigger?: React.ReactNode;
  /**
   * Controlled mode (no trigger): open state. The popover anchors to this
   * component's own position in the DOM, so render it near the control that
   * opens it (e.g. next to a row's menu button).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Popover alignment relative to the trigger/anchor. */
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * A filterable branch switcher with Local / Remote groups, shared by the Git
 * Graph header and the Repos row menu. Fetches branches fresh each time it
 * opens, so it never shows a stale list.
 */
export function BranchCombobox({
  path,
  current,
  onSwitch,
  disabled = false,
  modal = false,
  trigger,
  open: openProp,
  onOpenChange,
  align = "start",
  className,
}: BranchComboboxProps) {
  const [openState, setOpenState] = React.useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (o: boolean) => {
    if (!isControlled) setOpenState(o);
    onOpenChange?.(o);
  };

  const [branches, setBranches] = React.useState<{ local: string[]; remote: string[] }>({
    local: [],
    remote: [],
  });
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void api
      .listBranches(path)
      .then((b) => {
        if (!cancelled) setBranches({ local: b.local, remote: b.remote });
      })
      .catch(() => {
        if (!cancelled) setBranches({ local: [], remote: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  const select = (branch: string) => {
    setOpen(false);
    if (branch !== current) onSwitch(branch);
  };

  const renderItem = (branch: string) => (
    <CommandItem key={branch} value={branch} onSelect={() => select(branch)}>
      <CheckIcon
        className={cn("size-3.5", branch === current ? "opacity-100" : "opacity-0")}
      />
      <span className="truncate">{branch}</span>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      {trigger ? (
        <PopoverTrigger asChild disabled={disabled}>
          {trigger}
        </PopoverTrigger>
      ) : (
        <PopoverAnchor />
      )}
      <PopoverContent className={cn("w-64 p-0", className)} align={align}>
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Filter branches…" className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>{loading ? "Loading…" : "No branches."}</CommandEmpty>
            {branches.local.length > 0 && (
              <CommandGroup heading="Local">{branches.local.map(renderItem)}</CommandGroup>
            )}
            {branches.remote.length > 0 && (
              <CommandGroup heading="Remote">
                {branches.remote.map(renderItem)}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
