import { AlertTriangle, Check, Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The one plugin without which the app itself stops working. */
const REQUIRED_PLUGIN = "workhub";
const MARKETPLACE = "workhub-marketplace";
/** The tiers the owner is pointed at afterwards rather than opted into here. */
const SUGGESTED = "engineering, persona";

type StepId = "template" | "marketplace" | "plugin";
type StepState = "checking" | "todo" | "done" | "running" | "failed";

interface Step {
  id: StepId;
  title: string;
  detail: string;
  state: StepState;
  /** stdout/stderr of a `claude plugin` run, or the error that stopped it. */
  output: string;
  /** What to run by hand when the app cannot. */
  manual: string;
}

const STEPS: Omit<Step, "state" | "output">[] = [
  {
    id: "template",
    title: "Apply the vault template",
    detail:
      "Creates the task, project and knowledge folders. Existing files are never overwritten.",
    manual: "",
  },
  {
    id: "marketplace",
    title: "Register the workhub marketplace",
    detail: "claude plugin marketplace add atman-33/workhub",
    manual: "claude plugin marketplace add atman-33/workhub",
  },
  {
    id: "plugin",
    title: "Enable the workhub plugin",
    detail:
      "Writes one key to ~/.claude/settings.json (user scope). Applies from the next session.",
    manual: "claude plugin install workhub@workhub-marketplace",
  },
];

/**
 * First-run setup, as one confirmation and one action.
 *
 * Picking a vault folder used to be the whole of the app's onboarding, which
 * left a new owner on an empty board with no template applied, no marketplace
 * registered and therefore no plugin that could be switched on — the Plugins
 * tab's toggle writes `enabledPlugins` and nothing else, so switching workhub
 * on first only bought a "plugin not cached" at the next session (T-0297).
 *
 * The three steps have no choice in them: on an empty folder there is no
 * sensible alternative to any of them, and asking three times in a row is
 * homework rather than consent. They do all reach outside the vault, though —
 * an external CLI, a network fetch, a write to the machine's own settings — so
 * they are named up front and run on one deliberate press, never silently.
 *
 * Only `workhub` is switched on. Required means "the app breaks without it",
 * which is not a preference; the recommended plugins are preferences, and
 * turning four of them on across the machine because someone picked a folder
 * is not something a folder picker was asked to do.
 */
export function VaultSetupDialog({
  vaultPath,
  open,
  onClose,
  onDone,
}: {
  vaultPath: string;
  /** Opened by the caller; the dialog never opens itself. */
  open: boolean;
  onClose: () => void;
  /** Fired after a run that changed something, so the board can reload. */
  onDone: () => void;
}) {
  const [steps, setSteps] = useState<Step[]>(
    STEPS.map((s) => ({ ...s, state: "checking", output: "" })),
  );
  const [running, setRunning] = useState(false);
  /** True once a run has finished, so the footer can offer "Close" over "Later". */
  const [ran, setRan] = useState(false);

  const setStep = useCallback((id: StepId, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  /** Re-reads what is already true, so a re-opened dialog is never misleading. */
  const check = useCallback(async () => {
    setSteps(STEPS.map((s) => ({ ...s, state: "checking", output: "" })));
    const initialized = await api.vaultInitialized(vaultPath).catch(() => false);
    setStep("template", { state: initialized ? "done" : "todo" });

    const state = await api.pluginsState(vaultPath).catch(() => null);
    const registered = (state?.marketplaces ?? []).some((m) => m.name === MARKETPLACE);
    setStep("marketplace", { state: registered ? "done" : "todo" });
    const enabled = (state?.rows ?? []).some(
      (r) => r.name === REQUIRED_PLUGIN && (r.enabled_user || r.enabled_project),
    );
    setStep("plugin", { state: enabled ? "done" : "todo" });
  }, [vaultPath, setStep]);

  useEffect(() => {
    if (open) void check();
  }, [open, check]);

  /** Runs one step. Returns false when the run should not continue past it. */
  const runStep = useCallback(
    async (id: StepId): Promise<boolean> => {
      setStep(id, { state: "running", output: "" });
      try {
        if (id === "template") {
          await api.initVault(vaultPath);
        } else if (id === "marketplace") {
          const result = await api.pluginsAddMarketplace(vaultPath);
          setStep(id, {
            state: result.ok ? "done" : "failed",
            output: result.output,
          });
          return result.ok;
        } else {
          await api.setPluginEnabled(vaultPath, REQUIRED_PLUGIN, MARKETPLACE, "user", true);
        }
        setStep(id, { state: "done" });
        return true;
      } catch (e) {
        setStep(id, { state: "failed", output: String(e) });
        return false;
      }
    },
    [vaultPath, setStep],
  );

  /**
   * Runs every outstanding step, in order, stopping at the first failure:
   * registering the marketplace is what makes enabling the plugin mean
   * anything, so carrying on past a failed step would only write a key that
   * resolves to nothing.
   */
  const runAll = useCallback(async () => {
    setRunning(true);
    setRan(true);
    try {
      for (const step of steps) {
        if (step.state === "done") continue;
        if (!(await runStep(step.id))) break;
      }
      onDone();
    } finally {
      setRunning(false);
    }
  }, [steps, runStep, onDone]);

  const retry = useCallback(
    async (id: StepId) => {
      setRunning(true);
      try {
        await runStep(id);
        onDone();
      } finally {
        setRunning(false);
      }
    },
    [runStep, onDone],
  );

  const checking = steps.some((s) => s.state === "checking");
  const outstanding = steps.filter((s) => s.state !== "done" && s.state !== "checking");
  const allDone = !checking && outstanding.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Set up this vault</DialogTitle>
          <DialogDescription>
            {allDone
              ? "This vault is already set up — nothing below needs running."
              : "Three steps, run together. Each one reaches outside the vault, so nothing here runs until you press the button."}
          </DialogDescription>
        </DialogHeader>

        <p className="truncate font-mono text-[11px] text-muted-foreground">{vaultPath}</p>

        <div className="space-y-2">
          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "rounded border p-3 text-xs",
                step.state === "failed" && "border-destructive/40 bg-destructive/5",
                step.state === "done" && "text-muted-foreground",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {step.state === "running" || step.state === "checking" ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  ) : step.state === "done" ? (
                    <Check className="size-3.5 text-primary" />
                  ) : step.state === "failed" ? (
                    <AlertTriangle className="size-3.5 text-destructive" />
                  ) : (
                    <span className="block size-3.5 rounded-full border border-muted-foreground/40" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{step.title}</span>
                    {step.state === "done" && (
                      <span className="text-[10px] tracking-wide uppercase">done</span>
                    )}
                  </div>
                  <p className="mt-0.5 leading-relaxed text-muted-foreground">{step.detail}</p>
                  {step.output && (
                    <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {step.output}
                    </pre>
                  )}
                  {step.state === "failed" && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 text-[11px]"
                        disabled={running}
                        onClick={() => void retry(step.id)}
                      >
                        <RotateCw className="size-3" /> Retry
                      </Button>
                      {step.manual && (
                        <span className="text-[11px] text-muted-foreground">
                          or run <code className="font-mono">{step.manual}</code> yourself
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Only <code className="font-mono">workhub</code> is switched on — it is the one plugin
          the app itself needs. The recommended ones ({SUGGESTED}) are a matter of how you like
          to work; turn them on in the <span className="font-medium">Plugins</span> tab, where
          you can read what each one carries first.
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={running} onClick={onClose}>
            {ran || allDone ? "Close" : "Later"}
          </Button>
          <Button
            size="sm"
            disabled={running || checking || allDone}
            onClick={() => void runAll()}
          >
            {running
              ? "Running…"
              : `Run setup${outstanding.length ? ` (${outstanding.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
