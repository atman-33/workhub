import type { ReactNode } from "react";
import { Keyboard, PenLine, Rocket } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// NOTE: This screen documents user-facing operations and setup steps. When an
// operation or setup flow changes elsewhere in the app (ink shortcuts, quick
// capture, first-run setup, settings), update the matching section here too.
// See .claude/rules/help-screen.md.

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

function Section({
  icon: Icon,
  title,
  value,
  children,
}: {
  icon: typeof Rocket;
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 text-sm text-muted-foreground">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

export function HelpView() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <h1 className="text-lg font-semibold">How to use workhub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A quick reference for setup and the shortcuts that aren't obvious from
          the UI.
        </p>

        <Accordion
          type="multiple"
          defaultValue={["setup", "ink", "quick-capture"]}
          className="mt-4"
        >
          <Section icon={Rocket} title="Initial setup" value="setup">
            <p>Three steps to get workhub ready on a new machine.</p>
            <ol className="ml-4 list-decimal space-y-2">
              <li>
                <span className="font-medium text-foreground">
                  Create the task vault.
                </span>{" "}
                On first launch the <span className="font-medium">Tasks</span>{" "}
                tab asks you to choose a folder — pick an empty one (e.g.{" "}
                <span className="font-mono text-xs">C:/obsidian/workhub-vault</span>
                ) and press <span className="font-medium">Init vault</span> to
                expand the bundled template into it. You can change it later in{" "}
                <span className="font-medium">⚙ Settings → Tasks vault path</span>.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Install the Claude Code plugins.
                </span>{" "}
                <span className="font-mono text-xs">workhub</span> and{" "}
                <span className="font-mono text-xs">engineering</span> are
                pre-enabled by the vault template (just accept the trust
                prompt on first launch). Also install these recommended
                plugins from a terminal:
                <pre className="mt-1.5 overflow-x-auto rounded-md border bg-muted/50 p-2 font-mono text-[11px] text-foreground">
                  {"claude plugin marketplace add atman-33/workhub\n\n" +
                    "# engineering — dev workflow skills, sub-agents, MCP launchers\n" +
                    "claude plugin install engineering@workhub-marketplace --scope project\n\n" +
                    "# productivity — personal/machine tools (work logs, reports, ...)\n" +
                    "claude plugin install productivity@workhub-marketplace\n\n" +
                    "# obsidian — Obsidian Flavored Markdown, Bases, Canvas helpers\n" +
                    "claude plugin install obsidian@workhub-marketplace"}
                </pre>
                <span className="mt-1 block text-xs">
                  <span className="font-mono">engineering</span> is project
                  scope (per repository); <span className="font-mono">
                    productivity
                  </span>{" "}
                  is user scope (once per machine, works from any directory);{" "}
                  <span className="font-mono">obsidian</span> is optional but
                  recommended for editing vault notes. See{" "}
                  <span className="font-mono">docs/plugins.md</span> in the
                  workhub repo for the full catalog.
                </span>
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Register your repositories.
                </span>{" "}
                In the <span className="font-medium">Repos</span> tab press{" "}
                <span className="font-medium">Add</span> and pick the local
                repository folders you work in. A task's{" "}
                <span className="font-mono text-xs">project</span> field refers
                to these.
              </li>
            </ol>
          </Section>

          <Section icon={PenLine} title="Screen annotation (ink)" value="ink">
            <p>
              Draw temporary strokes anywhere on screen — handy when narrating or
              reviewing.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Double-press <Kbd>Alt</Kbd> and hold the second press to start
                drawing.
              </li>
              <li>
                <Kbd>Alt</Kbd> + <Kbd>S</Kbd> cycles the pen color.
              </li>
              <li>
                Release <Kbd>Alt</Kbd> to clear the strokes.
              </li>
              <li>
                Can be disabled in <span className="font-medium">⚙ Settings</span>.
              </li>
            </ul>
          </Section>

          <Section
            icon={Keyboard}
            title="Capture a task from anywhere (quick capture)"
            value="quick-capture"
          >
            <p>
              A global hotkey opens a small always-on-top window that turns the
              current clipboard text into an{" "}
              <span className="font-mono text-xs">inbox</span> task, without
              switching to the app.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Press <Kbd>Ctrl</Kbd> + <Kbd>Alt</Kbd> + <Kbd>N</Kbd> (the
                default). If another app already holds that combination, workhub
                falls back to <Kbd>Ctrl</Kbd> + <Kbd>Shift</Kbd> + <Kbd>N</Kbd>.
              </li>
              <li>
                Edit the title and description, then save — the task lands in the
                Tasks board with status{" "}
                <span className="font-mono text-xs">inbox</span>.
              </li>
              <li>
                The shortcut can be changed in{" "}
                <span className="font-medium">⚙ Settings</span>.
              </li>
            </ul>
          </Section>
        </Accordion>
      </div>
    </div>
  );
}
