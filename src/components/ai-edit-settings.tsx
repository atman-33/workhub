import { ModelCombobox } from "@/components/model-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { VaultScopedBadge } from "@/components/vault-scoped-badge";
import { useT } from "@/lib/i18n";

/**
 * Which agent runs a natural-language edit, on which model, and whether the
 * result is reviewed before it lands (T-0289).
 *
 * One agent edits every kind of diagram (T-0685), so these three settings
 * belong to the Diagrams tab. Saving is the caller's job: the tab writes
 * through `api.patchSettings` the moment a control changes.
 */

interface Props {
  assignee: string;
  model: string;
  confirm: boolean;
  /** Whether the picker is on screen — gates the opencode catalog fetch. */
  active?: boolean;
  disabled?: boolean;
  onAssigneeChange: (assignee: string) => void;
  onModelChange: (model: string) => void;
  onConfirmChange: (confirm: boolean) => void;
}

export function AiEditSettings({
  assignee,
  model,
  confirm,
  active = true,
  disabled = false,
  onAssigneeChange,
  onModelChange,
  onConfirmChange,
}: Props) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          {t("misc.aiEditSettings.title")}
          <VaultScopedBadge />
        </p>
        <p className="text-xs text-muted-foreground">
          {t("misc.aiEditSettings.description")}
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("misc.aiEditSettings.agent")}
        </label>
        <Select value={assignee} onValueChange={onAssigneeChange} disabled={disabled}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-code">Claude Code</SelectItem>
            <SelectItem value="opencode">OpenCode</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("misc.aiEditSettings.model")}
        </label>
        <ModelCombobox
          assignee={assignee}
          value={model}
          onChange={onModelChange}
          active={active}
          disabled={disabled}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("misc.aiEditSettings.confirmDescription")}
        </p>
        <Switch checked={confirm} onCheckedChange={onConfirmChange} disabled={disabled} />
      </div>
    </div>
  );
}
