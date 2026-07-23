import { type ReactNode, useCallback, useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileDiff,
  Keyboard,
  MessageSquarePlus,
  Mic,
  PenLine,
  Rocket,
  Sparkles,
} from "lucide-react";
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

4. **Register your repositories.** In the **Repos** tab press **Add** and pick the local repository folders you work in. A task's \`project\` field refers to these.

Settings, voice history, and downloaded voice models are stored under \`~/.workhub/\` (your user home directory) rather than \`AppData\`. If Settings ever silently fail to stick after a restart, an antivirus product's folder-shielding blocking writes to \`AppData\\Roaming\` is a known cause of that on Windows — \`~/.workhub/\` was chosen precisely to avoid it, so it's a good first thing to check permissions on.`;

const TEMPLATE_MD = `## Vault template updates

The vault template (\`CLAUDE.md\`, skill configuration, and other shared files) can change between workhub versions. On startup, workhub compares the configured vault against the bundled template and, if anything differs, shows a banner.

- Each file is one of: **added** (missing in the vault, will be created), **updatable** (you haven't edited it and the template changed — safe to overwrite), **conflict** (you edited it *and* the template changed), or up to date (no action).
- A few files — such as \`.claude/project-context.json\`, \`.claude/settings.json\`, and the \`_index.md\` files kept up to date by \`/kb-index\` — are **seed files**: they're created once when missing and never compared or overwritten again, so this check never touches your registered repos or generated indexes.
- Press **Review** on the banner to see the list and pick which files to update. **added** and **updatable** files are pre-checked; **conflict** files are left unchecked.
- **Show diff** on any file renders the unified diff between your vault's copy and the incoming template content, so you can see exactly what an update would change before applying it.
- A **conflict** file offers two resolutions: **Keep mine (write .new)** — the default — writes a \`<name>.new\` file beside the original with the incoming content, leaving your file untouched so you can merge by hand and delete the \`.new\` afterwards; **Replace with template** overwrites your copy with the template's version. Replacing discards your edits to that file for good, so check the diff first.
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
- The shortcut can be changed in **⚙ Settings**.
- workhub has no tray icon: closing its main window quits the app entirely, and the hotkey stops working until you relaunch it.`;

const VOICE_MD = `## Voice input (local dictation)

A global hotkey turns speech into text and pastes it into whatever app has focus — fully offline, no cloud, no LLM.

- Press **Ctrl** + **Shift** + **Space** (the default) to start recording; press it again to stop and transcribe, or click the stop button on the indicator. Recording auto-stops after 2 minutes.
- The first time, download a model in **⚙ Settings → Voice** (\`tiny\`/\`base\`/\`small\` plus quantized variants; larger models are more accurate but slower). \`small-q5_1\` is a good speed/accuracy default on CPU; \`large-v3-turbo-q5_0\` is the most accurate and fast on a GPU. Transcription won't work until a model is downloaded.
- Transcription runs on the GPU (Vulkan) when one is available, and falls back to CPU automatically otherwise.
- A small indicator at the bottom of the screen shows recording (with elapsed time), transcribing, or an error. While speaking, it grows into a live preview of the transcript so far, built from short chunks transcribed as you go — no need to wait for the final pass.
- The indicator can be dragged anywhere on screen; workhub remembers where you left it and reopens it there next time.
- The transcript is copied to the clipboard, pasted into the focused app via Ctrl+V, and the previous clipboard content is restored afterward.
- Every transcript is also saved to the **Voice** tab as a safety net, even if the paste fails or its target app lost focus — the latest 50 transcripts are kept, each with copy and delete actions.
- The hotkey, model, and language (auto-detect, Japanese, English) can be changed in **⚙ Settings → Voice**.
- workhub has no tray icon: closing its main window quits the app entirely, and the hotkey stops working until you relaunch it.`;

const TIDY_MD = `## Vault tidy (automatic housekeeping)

Keeps the vault easy for AI to search: files stale notes out of \`inbox/\` and refreshes the \`tasks/archive/_index.md\` summary — by launching an agent headlessly (no terminal window).

- Turn it on in **⚙ Settings → Vault → Vault tidy**. It is **off by default**; leave it off if you drive the same routine from a Claude Desktop routine instead.
- The app decides *whether* there is work with a cheap mechanical scan (no tokens) — a run only starts when \`inbox/\` has a note older than the age threshold, or the archive index has drifted.
- **Schedule** is "first run at" + "run every N hours" (24 = daily, 168 = weekly). Because it counts from that anchor, a run missed while the app was closed is caught up on the next launch.
- Notes you're still writing: keep them in **\`inbox/_wip/\`** (or any folder listed under "Exclude folders") — tidy never touches those.
- Files that need human judgement (a new folder, a rename, unclear classification) are **not** filed silently. They surface as a single **\`#tidy-review\`** task on the board with a proposed plan per file — edit the proposals, then assign the task to an agent to execute them. Deferred files don't retrigger tidy runs until you touch them again.
- **Agent / Model** pick which CLI (Claude Code or OpenCode) and model run the routine, just like a task.
- **Run now** triggers it immediately, even when the schedule is off.
- The routine runs with the same auto-approve permission mode a task-card agent launch uses, so it doesn't sit waiting on prompts. An operation it isn't allowed to do is skipped rather than asked about, which can leave a run half-finished.
- **Resume session** picks up exactly where a run left off — after a failure, a stall, a killed process, or an app restart. The session id is shown next to the run status with a copy button, and is also written into the run log under \`_ai/logs/tidy/\`, so you can resume from a terminal yourself with \`claude --resume <id>\`. (OpenCode mints its own session ids, so there Resume just reopens the agent in the vault.)`;

const MEMORY_MD = `## Long-term memory for AI agents

Gives every agent session on the vault — Claude Code and OpenCode — a memory of past sessions, fully local, no cloud, no LLM. Each session's Q&A pairs are saved into \`<vault>/_ai/memory/memory.db\` (SQLite), and new sessions automatically receive a time summary ("last session was N days ago") plus past conversations relevant to the current prompt, found by hybrid keyword + vector search.

- **One-time setup per machine**: run the \`/memory-setup\` skill in a Claude Code session on the vault. It installs the engine's dependencies and a local Japanese-capable embedding model (~320 MB) under \`~/.workhub/memory-engine/\`. Nothing is compiled from source, so no C/C++ build tools are required — only Node 20+. Until then the memory hooks stay silently disabled, and workhub shows a startup banner as a reminder.
- **Recall on demand**: the \`/memory-recall <keyword> [days]\` skill searches past conversations explicitly; without arguments it lists the recent timeline.
- **Privacy**: the database stores conversation text verbatim and may contain sensitive material, so setup adds it to the vault's \`.gitignore\` — it never leaves the machine with a vault backup.
- **Per-agent switches**: **⚙ Settings → General** has separate toggles for Claude Code and OpenCode sessions (both on by default). OpenCode support runs through the vault's \`.opencode/plugins/memory-plugin.ts\`, which uses the same engine and database.
- The setup banner can be disabled in **⚙ Settings → General → Notify when long-term memory is not set up on this machine**.`;

const CUSTOM_PROMPT_MD = `## Your own instructions in every agent prompt

Every task you hand to an agent — by launching it or by copying its prompt — is sent with a generated prompt telling the agent which task to work and how to report back. **⚙ Settings → Commands → Custom prompt** lets you append your own standing instructions to it.

- Whatever you write there is added to the end of *every* task prompt, so it fits instructions that always apply (e.g. "Respond to me in Japanese", "Ask before touching CI config") rather than task-specific ones — those belong in the task's own Description.
- Line breaks are collapsed into spaces when the prompt is built, so a multi-line note stays a single valid command line. Leave the field empty to add nothing.
- It applies equally to **Copy prompt**, so a prompt pasted into another terminal by hand carries the same instructions.`;

const ALL_MD = [
  SETUP_MD,
  TEMPLATE_MD,
  MEMORY_MD,
  CUSTOM_PROMPT_MD,
  INK_MD,
  QUICK_CAPTURE_MD,
  VOICE_MD,
  TIDY_MD,
].join("\n\n---\n\n");

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

/**
 * Section order and labels, shared by the table of contents and the
 * expand/collapse-all control. Keep in sync with the <Section> elements below:
 * every section rendered there needs an entry here, or it drops out of the
 * contents row and out of "Expand all".
 */
const SECTIONS = [
  { value: "setup", title: "Initial setup", icon: Rocket },
  { value: "template", title: "Vault template updates", icon: FileDiff },
  { value: "memory", title: "Long-term memory", icon: BrainCircuit },
  { value: "custom-prompt", title: "Your own instructions", icon: MessageSquarePlus },
  { value: "ink", title: "Screen annotation", icon: PenLine },
  { value: "quick-capture", title: "Quick capture", icon: Keyboard },
  { value: "voice", title: "Voice input", icon: Mic },
  { value: "tidy", title: "Vault tidy", icon: Sparkles },
] as const;

const ALL_SECTION_VALUES = SECTIONS.map((s) => s.value as string);

function sectionDomId(value: string) {
  return `help-section-${value}`;
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
    <AccordionItem value={value} id={sectionDomId(value)} className="scroll-mt-2">
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
  // Start fully collapsed: with every section closed the accordion headers are
  // themselves the table of contents, which is the fastest way to find a topic
  // now that the guide has grown past a screenful.
  const [openSections, setOpenSections] = useState<string[]>([]);

  const handleCopy = (id: string, markdown: string) => {
    void navigator.clipboard.writeText(markdown);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
  };

  const allOpen = openSections.length === ALL_SECTION_VALUES.length;

  const toggleAll = useCallback(() => {
    setOpenSections(allOpen ? [] : [...ALL_SECTION_VALUES]);
  }, [allOpen]);

  // Contents row: open the target section (if it is closed) and scroll to it.
  // The scroll waits a frame so it measures the section after the accordion has
  // committed the expansion, not at its collapsed position.
  const jumpTo = useCallback((value: string) => {
    setOpenSections((prev) => (prev.includes(value) ? prev : [...prev, value]));
    requestAnimationFrame(() => {
      document
        .getElementById(sectionDomId(value))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

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
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={toggleAll}
            >
              {allOpen ? (
                <ChevronsDownUp className="size-3.5" />
              ) : (
                <ChevronsUpDown className="size-3.5" />
              )}
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
            <CopyButton
              id="all"
              markdown={ALL_MD}
              copiedId={copiedId}
              onCopy={handleCopy}
              label="Copy all"
            />
          </div>
        </div>

        {/* Table of contents. Stays available once sections are open, so the
            user can move between topics without collapsing everything first. */}
        <nav aria-label="Contents" className="mt-4 flex flex-wrap gap-1.5">
          {SECTIONS.map(({ value, title, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              size="xs"
              variant="outline"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => jumpTo(value)}
            >
              <Icon className="size-3.5" />
              {title}
            </Button>
          ))}
        </nav>

        <Accordion
          type="multiple"
          value={openSections}
          onValueChange={setOpenSections}
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
            <p>
              Settings, voice history, and downloaded voice models are stored
              under <span className="font-mono text-xs">~/.workhub/</span>{" "}
              (your user home directory) rather than{" "}
              <span className="font-mono text-xs">AppData</span>. If Settings
              ever silently fail to stick after a restart, an antivirus
              product's folder-shielding blocking writes to{" "}
              <span className="font-mono text-xs">AppData\Roaming</span> is a
              known cause of that on Windows —{" "}
              <span className="font-mono text-xs">~/.workhub/</span> was
              chosen precisely to avoid it, so it's a good first thing to
              check permissions on.
            </p>
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
                A few files — such as{" "}
                <span className="font-mono text-xs">.claude/project-context.json</span>,{" "}
                <span className="font-mono text-xs">.claude/settings.json</span>, and the{" "}
                <span className="font-mono text-xs">_index.md</span> files kept up to date
                by <span className="font-mono text-xs">/kb-index</span> — are{" "}
                <span className="font-medium text-foreground">seed files</span>: they're
                created once when missing and never compared or overwritten again, so this
                check never touches your registered repos or generated indexes.
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
                original with the incoming template content, so you can compare and merge
                by hand; delete it once you're done.
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
            icon={BrainCircuit}
            title="Long-term memory for AI agents"
            value="memory"
            markdown={MEMORY_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
          >
            <p>
              Gives every agent session on the vault — Claude Code and OpenCode — a
              memory of past sessions, fully local, no cloud, no LLM. Each
              session&apos;s Q&amp;A pairs are saved into{" "}
              <span className="font-mono text-xs">_ai/memory/memory.db</span> in the
              vault, and new sessions automatically receive a time summary (&quot;last
              session was N days ago&quot;) plus past conversations relevant to the
              current prompt, found by hybrid keyword + vector search.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <span className="font-medium text-foreground">One-time setup per machine</span>
                : run the <span className="font-mono text-xs">/memory-setup</span> skill in
                a Claude Code session on the vault. It installs the engine&apos;s
                dependencies and a local embedding model (~320 MB) under{" "}
                <span className="font-mono text-xs">~/.workhub/memory-engine/</span>. Nothing
                is compiled from source, so no C/C++ build tools are required — only Node
                20+. Until then the memory hooks stay silently disabled, and workhub shows a
                startup banner as a reminder.
              </li>
              <li>
                <span className="font-medium text-foreground">Recall on demand</span>: the{" "}
                <span className="font-mono text-xs">/memory-recall</span> skill searches
                past conversations explicitly; without arguments it lists the recent
                timeline.
              </li>
              <li>
                <span className="font-medium text-foreground">Privacy</span>: the database
                stores conversation text verbatim and may contain sensitive material, so
                setup adds it to the vault&apos;s{" "}
                <span className="font-mono text-xs">.gitignore</span> — it never leaves
                the machine with a vault backup.
              </li>
              <li>
                <span className="font-medium text-foreground">Per-agent switches</span>:{" "}
                <span className="font-medium">⚙ Settings → General</span> has separate
                toggles for Claude Code and OpenCode sessions (both on by default).
                OpenCode support runs through the vault&apos;s{" "}
                <span className="font-mono text-xs">.opencode/plugins/memory-plugin.ts</span>,
                which uses the same engine and database.
              </li>
              <li>
                The setup banner can be disabled in{" "}
                <span className="font-medium">
                  ⚙ Settings → General → Notify when long-term memory is not set up on
                  this machine
                </span>
                .
              </li>
            </ul>
          </Section>

          <Section
            icon={MessageSquarePlus}
            title="Your own instructions in every agent prompt"
            value="custom-prompt"
            markdown={CUSTOM_PROMPT_MD}
            copiedId={copiedId}
            onCopy={handleCopy}
          >
            <p>
              Every task you hand to an agent — by launching it or by copying its
              prompt — is sent with a generated prompt telling the agent which task to
              work and how to report back.{" "}
              <span className="font-medium">⚙ Settings → Commands → Custom prompt</span>{" "}
              lets you append your own standing instructions to it.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Whatever you write there is added to the end of <em>every</em> task
                prompt, so it fits instructions that always apply (e.g. &quot;Respond to
                me in Japanese&quot;) rather than task-specific ones — those belong in
                the task&apos;s own Description.
              </li>
              <li>
                Line breaks are collapsed into spaces when the prompt is built, so a
                multi-line note stays a single valid command line. Leave the field empty
                to add nothing.
              </li>
              <li>
                It applies equally to <span className="font-medium">Copy prompt</span>,
                so a prompt pasted into another terminal by hand carries the same
                instructions.
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
              <li>
                workhub has no tray icon: closing its main window quits the
                app entirely, and the hotkey stops working until you
                relaunch it.
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
                <span className="font-mono text-xs">small</span> plus
                quantized variants; larger models are more accurate but
                slower). <span className="font-mono text-xs">small-q5_1</span>{" "}
                is a good speed/accuracy default on CPU;{" "}
                <span className="font-mono text-xs">large-v3-turbo-q5_0</span>{" "}
                is the most accurate and fast on a GPU. Transcription won't
                work until a model is downloaded.
              </li>
              <li>
                Transcription runs on the GPU (Vulkan) when one is
                available, and falls back to CPU automatically otherwise.
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
              <li>
                workhub has no tray icon: closing its main window quits the
                app entirely, and the hotkey stops working until you
                relaunch it.
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
