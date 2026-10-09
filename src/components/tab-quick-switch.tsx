import { useEffect, useState, type ComponentType } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useT } from "@/lib/i18n";

export interface QuickSwitchTab {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hidden: boolean;
}

/**
 * Ctrl+K palette that jumps to any tab by name (T-0684). It lists every tab,
 * hidden ones included — hiding a tab declutters the bar, it must not make the
 * tab unreachable — and keeps working however many tabs there are.
 */
export function TabQuickSwitch({
  tabs,
  onSelect,
}: {
  tabs: QuickSwitchTab[];
  onSelect: (key: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "k") return;
      // A shell in the embedded terminal uses Ctrl+K itself (kill line).
      if (e.target instanceof Element && e.target.closest(".xterm")) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("nav.quickSwitch.title")}
      description={t("nav.quickSwitch.description")}
      showCloseButton={false}
    >
      <CommandInput placeholder={t("nav.quickSwitch.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("nav.quickSwitch.empty")}</CommandEmpty>
        {tabs.map(({ key, label, icon: Icon, hidden }) => (
          <CommandItem
            key={key}
            value={label}
            onSelect={() => {
              setOpen(false);
              onSelect(key);
            }}
          >
            <Icon className="size-4" />
            {label}
            {hidden && (
              <span className="ml-auto text-xs text-muted-foreground">
                {t("nav.quickSwitch.hidden")}
              </span>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
