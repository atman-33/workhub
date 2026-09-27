import * as React from "react";
import { GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface BranchFilter {
  extraBranches: string[];
  showAll: boolean;
}

interface Props {
  /** Repository path — branches and defaults are fetched lazily on open. */
  path: string;
  extraBranches: string[];
  showAll: boolean;
  onChange: (next: BranchFilter) => void;
  disabled?: boolean;
  /** Controlled open state, so the "taking a while" notice can open this
   * popover directly from its "Choose branches" button. Uncontrolled
   * (click-to-open) when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Toolbar control for the git graph's branch filter (T-0408): a "show every
 * ref" toggle, plus a checklist of local/remote branches to add on top of
 * the dynamically-computed default set (HEAD, the default branch, and their
 * upstreams — fetched from `git_default_log_refs` and shown here as
 * always-on, since the user did not choose them and cannot turn them off).
 */
export function BranchFilterPopover({
  path,
  extraBranches,
  showAll,
  onChange,
  disabled,
  open: openProp,
  onOpenChange,
}: Props) {
  const t = useT();
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
  const [defaults, setDefaults] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([api.listBranches(path), api.gitDefaultLogRefs(path)])
      .then(([b, d]) => {
        if (cancelled) return;
        setBranches({ local: b.local, remote: b.remote });
        setDefaults(d);
      })
      .catch(() => {
        if (!cancelled) {
          setBranches({ local: [], remote: [] });
          setDefaults([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  const extraSet = React.useMemo(() => new Set(extraBranches), [extraBranches]);
  const defaultSet = React.useMemo(() => new Set(defaults), [defaults]);

  const toggle = (branch: string) => {
    const next = extraSet.has(branch)
      ? extraBranches.filter((b) => b !== branch)
      : [...extraBranches, branch];
    onChange({ extraBranches: next, showAll });
  };

  const renderItem = (branch: string) => {
    const isDefault = defaultSet.has(branch);
    const checked = isDefault || extraSet.has(branch);
    return (
      <CommandItem
        key={branch}
        value={branch}
        disabled={isDefault}
        onSelect={() => toggle(branch)}
        className="gap-2"
      >
        <Checkbox checked={checked} disabled={isDefault} className="pointer-events-none" />
        <span className="truncate">{branch}</span>
        {isDefault && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {t("graph.branchFilter.defaultBadge")}
          </span>
        )}
      </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild disabled={disabled}>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <GitBranch className="size-3.5" />
          {showAll
            ? t("graph.branchFilter.allBranches")
            : t("graph.branchFilter.branchCount", { count: extraBranches.length })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-xs font-medium">{t("graph.branchFilter.showAll")}</span>
          <Switch
            checked={showAll}
            onCheckedChange={(v) => onChange({ extraBranches, showAll: v })}
          />
        </div>
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder={t("misc.branchCombobox.filterPlaceholder")}
            className="h-8 text-xs"
            disabled={showAll}
          />
          <CommandList className={cn(showAll && "pointer-events-none opacity-50")}>
            <CommandEmpty>
              {loading ? t("misc.branchCombobox.loading") : t("misc.branchCombobox.noBranches")}
            </CommandEmpty>
            {branches.local.length > 0 && (
              <CommandGroup heading={t("misc.branchCombobox.local")}>
                {branches.local.map(renderItem)}
              </CommandGroup>
            )}
            {branches.remote.length > 0 && (
              <CommandGroup heading={t("misc.branchCombobox.remote")}>
                {branches.remote.map(renderItem)}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
