import { WandSparkles } from "lucide-react";
import { PanelFrame } from "@/components/diagram/panel-frame";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { SYMBOLS } from "@/lib/diagram/pfd/symbols";
import { useLocale, useT } from "@/lib/i18n";

/**
 * What the side panel shows with nothing selected: the symbols and which
 * arrows are allowed between them, and the "auto-align" command that forgets
 * every position a node was dragged to.
 */
export function OverviewPanel({
  canAutoAlign,
  onAutoAlign,
}: {
  canAutoAlign: boolean;
  onAutoAlign: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <PanelFrame>
      <span className="font-medium">{t("diagram.pfd.symbolsTitle")}</span>
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        {SYMBOLS.map((symbol) => (
          <li key={symbol.prefix}>
            <span className="font-mono text-foreground">{symbol.prefix}-</span>{" "}
            {symbol.label[locale]}
            {symbol.next.length > 0 &&
              ` → ${symbol.next
                .map((p) => SYMBOLS.find((s) => s.prefix === p)?.label[locale] ?? p)
                .join(", ")}`}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">{t("diagram.pfd.symbolsHint")}</p>

      <div className="space-y-1.5 border-t pt-3">
        <Hint label={t("diagram.pfd.autoAlignHint")} disabled={!canAutoAlign}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!canAutoAlign}
            onClick={onAutoAlign}
          >
            <WandSparkles className="mr-1 size-3" />
            {t("diagram.pfd.autoAlign")}
          </Button>
        </Hint>
      </div>
    </PanelFrame>
  );
}
