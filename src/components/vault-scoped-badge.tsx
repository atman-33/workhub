import { FolderGit2 } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";

/**
 * Marks a setting that is stored in the vault (`<vault>/.workhub/settings.json`)
 * instead of on this machine (T-0206). Without it the split is invisible: two
 * controls side by side look alike, yet one follows the vault to the user's
 * other PC and the other does not.
 */
export function VaultScopedBadge() {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <FolderGit2 className="size-3" />
          {t("misc.vaultScopedBadge.label")}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("misc.vaultScopedBadge.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
