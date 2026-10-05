import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export interface ArchiveFooterProps {
  shown: number;
  total: number;
  onMore: () => void;
  onAll: () => void;
}

/** Footer under a board's archived tasks while only the newest are drawn. */
export function ArchiveMoreFooter({ shown, total, onMore, onAll }: ArchiveFooterProps) {
  const t = useT();
  if (shown >= total) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
      <span>{t("task.archive.shown", { shown: String(shown), total: String(total) })}</span>
      <Button variant="outline" size="sm" onClick={onMore}>
        {t("task.archive.more")}
      </Button>
      <Button variant="ghost" size="sm" onClick={onAll}>
        {t("task.archive.all")}
      </Button>
    </div>
  );
}
