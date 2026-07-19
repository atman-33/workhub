import { type ReactNode, useState } from "react";
import { Check, Copy, FileDiff, Keyboard, Mic, PenLine, Rocket, Sparkles } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// NOTE: This screen documents user-facing operations and setup steps. When an
// operation or setup flow changes elsewhere in the app (ink shortcuts, quick
// capture, first-run setup, settings), update the matching section here too —
// including its markdown copy source below. See .claude/rules/help-screen.md.

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

const SETUP_MD = `## Initial setup

A few steps to get workhub ready on a new machine. The fastest path is to run the \`vault-setup\` skill in Claude Code from the vault folder — it checks and installs the prerequisites, initializes the vault, wires up the plugins, and syncs OpenCode. To do it by hand:

1. **Install the prerequisite software.** \`git\`, \`Node.js\` (≥ 20), and \`Claude Code\` are required. \`Obsidian\` (edit the vault by hand), \`OpenCode\` (optional second agent), and \`herdr\` (the default launcher — workhub opens each AI task in a fresh herdr workspace) are optional but recommended. The \`vault-setup\` skill probes for these and offers the install commands.
2. **Create the task vault.** On first launch the **Tasks** tab asks you to choose a folder — pick an empty one (e.g. \`C:/obsidian/workhub-vault\`) and press **Init vault** to expand the bundled template into it. You can change it later in **⚙ Settings → Vault → Tasks vault path**.
3. **Install the Claude Code plugins.** If you created the vault from the template, \`workhub\`, \`engineering\`, and \`obsidian\` are already enabled — just accept the trust prompt on first launch. To install everything manually (or from a non-template setup), run:

\`\`\`bash
# one-time: register the marketplace
claude plugin marketplace add atman-33/workhub

# workhub — task-board & vault knowledge-base skills
claude plugin install workhub@workhub-marketplace --scope project

# engineering — dev workflow skills, sub-agents, MCP launchers
claude plugin install engineering@workhub-marketplace --scope project

# productivity — personal/machine tools (work logs, reports, ...)
claude plugin install productivity@workhub-marketplace

# obsidian — Obsidian Flavored Markdown, Bases, Canvas helpers
claude plugin install obsidian@workhub-marketplace --scope project
\`\`\`

\`workhub\` and \`engineering\` are project scope (per vault/repository); \`productivity\` is user scope (once per machine, works from any directory); \`obsidian\` is optional but recommended for editing vault notes. See \`docs/plugins.md\` in the workhub repo for the full catalog.

4. **Register your repositories.** In the **Repos** tab press **Add** and pick the local repository folders you work in. A task's \`project\` field refers to these.`;

const TEMPLATE_MD = `## Vault template updates

The vault template (\`CLAUDE.md\`, skill configuration, and other shared files) can change between workhub versions. On startup, workhub compares the configured vault against the bundled template and, if anything differs, shows a banner.

- Each file is one of: **added** (missing in the vault, will be created), **updatable** (you haven't edited it and the template changed — safe to overwrite), **conflict** (you edited it *and* the template changed), or up to date (no action).
- Press **Review** on the banner to see the list and pick which files to update. **added** and **updatable** files are pre-checked; **conflict** files are left unchecked.
- Updating a **conflict** file never overwrites your edits — it writes a \`<name>.new\` file beside the original so you can merge by hand.
- Press **Later** to dismiss the banner for this session; it reappears on the next launch if updates are still pending.
- Can be disabled in **⚙ Settings → General → Check for vault template updates on startup**.`;

const INK_MD = `## Screen annotation (ink)

Draw temporary strokes anywhere on screen — handy when narrating or reviewing.

- Double-press **Alt** and hold the second press to start drawing.
- **Alt** + **S** cycles the pen color.
- Release **Alt** to clear the strokes.
- Can be disabled in **⚙ Settings**.`;

const QUICK_CAPTURE_MD = `## Capture a task from anywhere (quick capture)

A global hotkey opens a small always-on-top window that turns a copied link into an \`inbox\` task, without switching to the app. Typical use: a Slack message is about to get buried — copy its link, hit the hotkey, save, reply later.

- Press **Ctrl** + **Alt** + **N** (the default). If another app already holds that combination, workhub falls back to **Ctrl** + **Shift** + **N**.
- The clipboard is pasted into the description **only when it is a link workhub recognizes** — a Slack message, a GitHub pull request, or a monday.com item. The task is tagged accordingly (\`slack\`, \`github-pr\`, \`monday\`).
- Any other clipboard content is left out of the form and offered on a **Paste clipboard** button instead, so unrelated text never has to be deleted by hand.
- Edit the title and description, then save — the task lands in the Tasks board with status \`inbox\`.
- The shortcut can be changed in **⚙ Settings**.`;

const VOICE_MD = `## Voice input (local dictation)

A global hotkey turns speech into text and pastes it into whatever app has focus — fully offline, no cloud, no LLM.

- Press **Ctrl** + **Shift** + **Space** (the default) to start recording; press it again to stop and transcribe, or click the stop button on the indicator. Recording auto-stops after 2 minutes.
- The first time, download a model in **⚙ Settings → Voice** (\`tiny\`/\`base\`/\`small\`; larger models are more accurate but slower). Transcription won't work until a model is downloaded.
- A small indicator at the bottom of the screen shows recording (with elapsed time), transcribing, or an error. While speaking, it grows into a live preview of the transcript so far, built from short chunks transcribed as you go — no need to wait for the final pass.
- The indicator can be dragged anywhere on screen; workhub remembers where you left it and reopens it there next time.
- The transcript is copied to the clipboard, pasted into the focused app via Ctrl+V, and the previous clipboard content is restored afterward.
- Every transcript is also saved to the **Voice** tab as a safety net, even if the paste fails or its target app lost focus — the latest 50 transcripts are kept, each with copy and delete actions.
- The hotkey, model, and language (auto-detect, Japanese, English) can be changed in **⚙ Settings → Voice**.`;

const TIDY_MD = `## Vault tidy (automatic housekeeping)

Keeps the vault easy for AI to search: files stale notes out of \`inbox/\` and refreshes the \`tasks/archive/_index.md\` summary — by launching an agent headlessly (no terminal window).

- Turn it on in **⚙ Settings → Vault → Vault tidy**. It is **off by default**; leave it off if you drive the same routine from a Claude Desktop routine instead.
- The app decides *whether* there is work with a cheap mechanical scan (no tokens) — a run only starts when \`inbox/\` has a note older than the age threshold, or the archive index has drifted.
- **Schedule** is "first run at" + "run every N hours" (24 = daily, 168 = weekly). Because it counts from that anchor, a run missed while the app was closed is caught up on the next launch.
- Notes you're still writing: keep them in **\`inbox/_wip/\`** (or any folder listed under "Exclude folders") — tidy never touches those.
- Files that need human judgement (a new folder, a rename, unclear classification) are **not** filed silently. They surface as a single **\`#tidy-review\`** task on the board with a proposed plan per file — edit the proposals, then assign the task to an agent to execute them. Deferred files don't retrigger tidy runs until you touch them again.
- **Agent / Model** pick which CLI (Claude Code or OpenCode) and model run the routine, just like a task.
- **Run now** triggers it immediately, even when the schedule is off. If a run stalls on a permission prompt or fails, you get a desktop notification and a **Resume session** button opens it in a terminal so you can finish it by hand.`;

const ALL_MD = [SETUP_MD, TEMPLATE_MD, INK_MD, QUICK_CAPTURE_MD, VOICE_MD, TIDY_MD].join(
  "\n\n---\n\n",
);

function CopyButton({
  id,
  markdown,
  copiedId,
  onCopy,
  label,
  iconOnly = false,
  className,
}: {
  id: string;
  markdown: string;
  copiedId: string | null;
  onCopy: (id: string, markdown: string) => void;
  label: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const copied = copiedId === id;
  const Icon = copied ? Check : Copy;

  if (iconOnly) {
    return (
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={label}
        title={label}
        className={cn("text-muted-foreground", copied && "text-green-500", className)}
        onClick={() => onCopy(id, markdown)}
      >
        <Icon className="size-3.5" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("gap-1.5 text-xs", className)}
      onClick={() => onCopy(id, markdown)}
    >
      <Icon className={cn("size-3.5", copied && "text-green-500")} />
      {copied ? "Copied" : label}
    </Button>
  );
}

function Section({
  icon: Icon,
  title,
  value,
  markdown,
  copiedId,
  onCopy,
  children,
}: {
  icon: typeof Rocket;
  title: string;
  value: string;
  markdown: string;
  copiedId: string | null;
  onCopy: (id: string, markdown: string) => void;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value}>
      <div className="relative">
        <AccordionTrigger>
          <span className="flex items-center gap-2 pr-8">
            <Icon className="size-4 text-muted-foreground" />
            {title}
          </span>
        </AccordionTrigger>
        {/* Sibling of the trigger (which is itself a <button>, so we can't nest
            another button inside it): overlaid just left of the chevron. */}
        <CopyButton
          id={value}
          markdown={markdown}
          copiedId={copiedId}
          onCopy={onCopy}
          label="Copy section"
          iconOnly
          className="absolute top-1/2 right-7 -translate-y-1/2"
        />
      </div>
      <AccordionContent className="space-y-3 text-sm text-muted-foreground">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

export function HelpView() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, markdown: string) => {
    void navigator.clipboard.writeText(markdown);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">How to use workhub</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A quick reference for setup and the shortcuts that aren't obvious from
              the UI.
            </p>
          </div>
          <CopyButton
            id="all"
            markdown={ALL_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
            label="Copy all"
          />
        </div>

        <Accordion
          type="multiple"
          defaultValue={["setup", "template", "ink", "quick-capture", "voice", "tidy"]}
          className="mt-4"
        >
          <Section
            icon={Rocket}
            title="Initial setup"
            value="setup"
            markdown={SETUP_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
          >
            <p>
              A few steps to get workhub ready on a new machine. The fastest
              path is to run the{" "}
              <span className="font-mono">vault-setup</span> skill in Claude
              Code from the vault folder — it checks and installs the
              prerequisites, initializes the vault, wires up the plugins, and
              syncs OpenCode. To do it by hand:
            </p>
            <ol className="ml-4 list-decimal space-y-2">
              <li>
                <span className="font-medium text-foreground">
                  Install the prerequisite software.
                </span>{" "}
                <span className="font-mono text-xs">git</span>,{" "}
                <span className="font-mono text-xs">Node.js</span> (≥ 20), and{" "}
                <span className="font-mono text-xs">Claude Code</span> are
                required. <span className="font-mono text-xs">Obsidian</span>{" "}
                (edit the vault by hand),{" "}
                <span className="font-mono text-xs">OpenCode</span> (optional
                second agent), and{" "}
                <span className="font-mono text-xs">herdr</span> (the default
                launcher — workhub opens each AI task in a fresh herdr
                workspace) are optional but recommended. The{" "}
                <span className="font-mono">vault-setup</span> skill probes for
                these and offers the install commands.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Create the task vault.
                </span>{" "}
                On first launch the <span className="font-medium">Tasks</span>{" "}
                tab asks you to choose a folder — pick an empty one (e.g.{" "}
                <span className="font-mono text-xs">C:/obsidian/workhub-vault</span>
                ) and press <span className="font-medium">Init vault</span> to
                expand the bundled template into it. You can change it later in{" "}
                <span className="font-medium">⚙ Settings → Vault → Tasks vault path</span>.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Install the Claude Code plugins.
                </span>{" "}
                If you created the vault from the template,{" "}
                <span className="font-mono text-xs">workhub</span>,{" "}
                <span className="font-mono text-xs">engineering</span>, and{" "}
                <span className="font-mono text-xs">obsidian</span> are
                already enabled — just accept the trust prompt on first
                launch. To install everything manually (or from a non-template
                setup), run:
                <pre className="mt-1.5 overflow-x-auto rounded-md border bg-muted/50 p-2 font-mono text-[11px] text-foreground">
                  {"# one-time: register the marketplace\n" +
                    "claude plugin marketplace add atman-33/workhub\n\n" +
                    "# workhub — task-board & vault knowledge-base skills\n" +
                    "claude plugin install workhub@workhub-marketplace --scope project\n\n" +
                    "# engineering — dev workflow skills, sub-agents, MCP launchers\n" +
                    "claude plugin install engineering@workhub-marketplace --scope project\n\n" +
                    "# productivity — personal/machine tools (work logs, reports, ...)\n" +
                    "claude plugin install productivity@workhub-marketplace\n\n" +
                    "# obsidian — Obsidian Flavored Markdown, Bases, Canvas helpers\n" +
                    "claude plugin install obsidian@workhub-marketplace --scope project"}
                </pre>
                <span className="mt-1 block text-xs">
                  <span className="font-mono">workhub</span> and{" "}
                  <span className="font-mono">engineering</span> are project
                  scope (per vault/repository);{" "}
                  <span className="font-mono">productivity</span> is user scope
                  (once per machine, works from any directory);{" "}
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

          <Section
            icon={FileDiff}
            title="Vault template updates"
            value="template"
            markdown={TEMPLATE_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
          >
            <p>
              The vault template (<span className="font-mono text-xs">CLAUDE.md</span>,
              skill configuration, and other shared files) can change between workhub
              versions. On startup, workhub compares the configured vault against the
              bundled template and, if anything differs, shows a banner.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Each file is one of:{" "}
                <span className="font-medium text-foreground">added</span> (missing in
                the vault, will be created),{" "}
                <span className="font-medium text-foreground">updatable</span> (you
                haven't edited it and the template changed — safe to overwrite),{" "}
                <span className="font-medium text-foreground">conflict</span> (you edited
                it <em>and</em> the template changed), or up to date (no action).
              </li>
              <li>
                Press <span className="font-medium">Review</span> on the banner to see
                the list and pick which files to update.{" "}
                <span className="font-medium text-foreground">added</span> and{" "}
                <span className="font-medium text-foreground">updatable</span> files are
                pre-checked; <span className="font-medium text-foreground">conflict</span>{" "}
                files are left unchecked.
              </li>
              <li>
                Updating a <span className="font-medium text-foreground">conflict</span>{" "}
                file never overwrites your edits — it writes a{" "}
                <span className="font-mono text-xs">{"<name>.new"}</span> file beside the
                original so you can merge by hand.
              </li>
              <li>
                Press <span className="font-medium">Later</span> to dismiss the banner
                for this session; it reappears on the next launch if updates are still
                pending.
              </li>
              <li>
                Can be disabled in{" "}
                <span className="font-medium">
                  ⚙ Settings → General → Check for vault template updates on startup
                </span>
                .
              </li>
            </ul>
          </Section>

          <Section
            icon={PenLine}
            title="Screen annotation (ink)"
            value="ink"
            markdown={INK_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
          >
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
            markdown={QUICK_CAPTURE_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
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

          <Section
            icon={Mic}
            title="Voice input (local dictation)"
            value="voice"
            markdown={VOICE_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
          >
            <p>
              A global hotkey turns speech into text and pastes it into
              whatever app has focus — fully offline, no cloud, no LLM.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Press <Kbd>Ctrl</Kbd> + <Kbd>Shift</Kbd> + <Kbd>Space</Kbd>{" "}
                (the default) to start recording; press it again to stop and
                transcribe, or click the stop button on the indicator.
                Recording auto-stops after 2 minutes.
              </li>
              <li>
                The first time, download a model in{" "}
                <span className="font-medium">⚙ Settings → Voice</span> (
                <span className="font-mono text-xs">tiny</span>/
                <span className="font-mono text-xs">base</span>/
                <span className="font-mono text-xs">small</span>; larger
                models are more accurate but slower). Transcription won't
                work until a model is downloaded.
              </li>
              <li>
                A small indicator at the bottom of the screen shows
                recording (with elapsed time), transcribing, or an error.
                While speaking, it grows into a live preview of the
                transcript so far, built from short chunks transcribed as
                you go — no need to wait for the final pass.
              </li>
              <li>
                The indicator can be dragged anywhere on screen; workhub
                remembers where you left it and reopens it there next time.
              </li>
              <li>
                The transcript is copied to the clipboard, pasted into the
                focused app via Ctrl+V, and the previous clipboard content is
                restored afterward.
              </li>
              <li>
                Every transcript is also saved to the{" "}
                <span className="font-medium">Voice</span> tab as a safety
                net, even if the paste fails or its target app lost focus —
                the latest 50 transcripts are kept, each with copy and delete
                actions.
              </li>
              <li>
                The hotkey, model, and language can be changed in{" "}
                <span className="font-medium">⚙ Settings → Voice</span>.
              </li>
            </ul>
          </Section>

          <Section
            icon={Sparkles}
            title="Vault tidy (automatic housekeeping)"
            value="tidy"
            markdown={TIDY_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
          >
            <p>
              Keeps the vault easy for AI to search: files stale notes out of{" "}
              <span className="font-mono text-xs">inbox/</span> and refreshes the{" "}
              <span className="font-mono text-xs">tasks/archive/_index.md</span>{" "}
              summary — by launching an agent headlessly (no terminal window).
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Turn it on in{" "}
                <span className="font-medium">⚙ Settings → Vault → Vault tidy</span>.
                It is <span className="font-medium">off by default</span>; leave
                it off if you drive the same routine from a Claude Desktop
                routine instead.
              </li>
              <li>
                The app decides <em>whether</em> there is work with a cheap
                mechanical scan (no tokens) — a run only starts when{" "}
                <span className="font-mono text-xs">inbox/</span> has a note
                older than the age threshold, or the archive index has drifted.
              </li>
              <li>
                <span className="font-medium text-foreground">Schedule</span> is
                "first run at" + "run every N hours" (24 = daily, 168 = weekly).
                A run missed while the app was closed is caught up on the next
                launch.
              </li>
              <li>
                Notes you're still writing: keep them in{" "}
                <Kbd>inbox/_wip/</Kbd> (or any folder listed under "Exclude
                folders") — tidy never touches those.
              </li>
              <li>
                Files that need human judgement (a new folder, a rename, unclear
                classification) are <span className="font-medium">not</span>{" "}
                filed silently. They surface as a single{" "}
                <span className="font-mono text-xs">#tidy-review</span> task on
                the board with a proposed plan per file — edit the proposals,
                then assign the task to an agent to execute them. Deferred files
                don't retrigger tidy runs until you touch them again.
              </li>
              <li>
                <span className="font-medium text-foreground">Agent / Model</span>{" "}
                pick which CLI (Claude Code or OpenCode) and model run the
                routine, just like a task.
              </li>
              <li>
                <span className="font-medium text-foreground">Run now</span>{" "}
                triggers it immediately, even when the schedule is off. If a run
                stalls or fails, you get a desktop notification and a{" "}
                <span className="font-medium">Resume session</span> button opens
                it in a terminal so you can finish it by hand.
              </li>
            </ul>
          </Section>
        </Accordion>
      </div>
    </div>
  );
}
