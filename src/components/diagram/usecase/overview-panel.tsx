import { WandSparkles } from "lucide-react";
import { PanelFrame } from "@/components/diagram/panel-frame";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { SYMBOLS } from "@/lib/diagram/usecase/symbols";
import { useLocale, useT } from "@/lib/i18n";

/**
 * What the side panel shows with nothing selected: the legend of elements
 * (from the registry, so a new symbol appears here by itself), a nudge when
 * the diagram has no people yet, and the "auto-align" command that forgets
 * every position a node was dragged to.
 */
export function OverviewPanel({
  canAutoAlign,
  noPeople,
  onAutoAlign,
}: {
  canAutoAlign: boolean;
  noPeople: boolean;
  onAutoAlign: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <PanelFrame>
      <span className="font-medium">{t("diagram.usecase.symbolsTitle")}</span>
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        {SYMBOLS.map((symbol) => (
          <li key={symbol.kind}>
            <span className="font-mono text-foreground">
              {symbol.kind === "person" ? "—" : symbol.mark}
            </span>{" "}
            {symbol.label[locale]}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">{t("diagram.usecase.symbolsHint")}</p>
      {noPeople && <p className="text-[11px] text-amber-500">{t("diagram.usecase.noPeople")}</p>}

      <div className="space-y-1.5 border-t pt-3">
        <Hint label={t("diagram.usecase.autoAlignHint")} disabled={!canAutoAlign}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!canAutoAlign}
            onClick={onAutoAlign}
          >
            <WandSparkles className="mr-1 size-3" />
            {t("diagram.usecase.autoAlign")}
          </Button>
        </Hint>
      </div>
    </PanelFrame>
  );
}
