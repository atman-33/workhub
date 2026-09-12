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

/**
 * Which agent runs a natural-language edit, on which model, and whether the
 * result is reviewed before it lands (T-0289).
 *
 * The Schedule and Mindmap tabs each own their own copy of these three
 * settings, and both render them the same way, so the block lives here
 * instead of being written twice. Saving is the caller's job: the tab writes
 * through `api.patchSettings` the moment a control changes.
 */

interface Props {
  /** What the agent edits, for the wording ("schedule", "mindmap"). */
  subject: string;
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
  subject,
  assignee,
  model,
  confirm,
  active = true,
  disabled = false,
  onAssigneeChange,
  onModelChange,
  onConfirmChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          Edit with AI
          <VaultScopedBadge />
        </p>
        <p className="text-xs text-muted-foreground">
          Agent used when you edit this {subject} with a natural-language instruction.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Agent</label>
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
        <label className="text-xs font-medium text-muted-foreground">Model</label>
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
          Show what would change and wait for approval instead of applying immediately.
        </p>
        <Switch checked={confirm} onCheckedChange={onConfirmChange} disabled={disabled} />
      </div>
    </div>
  );
}
