/**
 * The Help tab's text in English (T-0428) — the reference copy.
 *
 * Each section is Markdown, and that Markdown is both what the tab renders and
 * what its copy buttons put on the clipboard, so there is one text per
 * language to keep up to date. `help.ja.ts` carries the same sections in
 * Japanese; when a section here changes, change it there in the same commit.
 */
import type { HelpSections } from "./types";

export const helpEn: HelpSections = {
  "setup": {
    short: "Initial setup",
    title: "Initial setup",
    body: `A few steps to get workhub ready on a new machine. The fastest path is to run the \`vault-setup\` skill in Claude Code from the vault folder — it checks and installs the prerequisites, initializes the vault, wires up the plugins, and syncs OpenCode. To do it by hand:

1. **Install the prerequisite software.** \`git\`, \`Node.js\` (≥ 20), and \`Claude Code\` are required. \`Obsidian\` (edit the vault by hand), \`OpenCode\` (optional second agent), and \`herdr\` (the default launcher — workhub opens each AI task in a fresh herdr workspace) are optional but recommended. The \`vault-setup\` skill probes for these and offers the install commands.
2. **Create the task vault, and let the app set it up.** On first launch the **Tasks** tab asks you to choose a folder — pick an empty one (e.g. \`C:/obsidian/workhub-vault\`). Choosing it opens the **setup dialog**, which names three steps and runs them together on one press: expand the bundled template into the folder, register the marketplace, and switch on the \`workhub\` plugin at user scope. Each step is skipped when it is already done, so the dialog is safe to re-open; a failed step offers a retry and the command to run by hand. Press **Later** and a banner keeps the way back. You can change the folder later in **⚙ Settings → Vault folder**; **Init vault** stays in the toolbar for re-applying the template.
3. **Add the plugins you want.** Setup switches on \`workhub\` alone — the one plugin the app itself needs. Everything else is a matter of how you like to work, so it is left to you: the **Plugins** tab lists every plugin with its tier, what it carries, and a toggle. To do it from a terminal instead:

\`\`\`bash
# one-time: register the marketplace
claude plugin marketplace add atman-33/workhub

# workhub — task board, vault knowledge base, harness hooks (the only required one)
claude plugin install workhub@workhub-marketplace

# engineering — dev workflow skills, sub-agents, MCP launchers
claude plugin install engineering@workhub-marketplace

# claude-tooling — Claude Code's own commands, skills, update notices
claude plugin install claude-tooling@workhub-marketplace

# authoring / agent-ops / zenn — optional tools
claude plugin install authoring@workhub-marketplace

# obsidian — Obsidian Flavored Markdown, Bases, Canvas helpers
claude plugin install obsidian@workhub-marketplace
\`\`\`

Every one of those installs at user scope, which is the default: once per machine, available from any directory, and toggled from the **Plugins** tab. \`workhub\` is the only required plugin — the app names its skills in its own launch prompts and its hooks are what carry your registered repositories into a session. \`engineering\` and \`persona\` are recommended, the rest are per taste; \`--scope project\` is there if you ever want one plugin in a single repository and nowhere else. See \`docs/plugins.md\` in the workhub repo for the full catalog.

4. **Register your repositories.** In the **Repos** tab press **Add** and pick the local repository folders you work in. A task's \`project\` field refers to these.

Settings, voice history, and downloaded voice models are stored under \`~/.workhub/\` (your user home directory) rather than \`AppData\`. If Settings ever silently fail to stick after a restart, an antivirus product's folder-shielding blocking writes to \`AppData\\Roaming\` is a known cause of that on Windows — \`~/.workhub/\` was chosen precisely to avoid it, so it's a good first thing to check permissions on.`,
  },
  "zoom": {
    short: "App zoom",
    title: "App zoom",
    body: `The whole app scales like a browser page — handy on high-resolution monitors where the text reads small.

- **Ctrl+=** zooms in, **Ctrl+-** zooms out, **Ctrl+0** resets to 100%. The range is 50–200% in 10% steps.
- The **% readout** beside the version at the right end of the tab bar opens the same controls: −/+ buttons, a slider and a reset.
- The zoom is remembered on this machine and re-applied on startup. The Docs preview's own text zoom and the mindmap/schedule gestures are unaffected.`,
  },
  "template": {
    short: "Vault template updates",
    title: "Vault template updates",
    body: `The vault template (\`CLAUDE.md\`, skill configuration, and other shared files) can change between workhub versions. On startup, workhub compares the configured vault against the bundled template and, if anything differs, shows a banner.

- Each file is one of: **added** (missing in the vault, will be created), **updatable** (you haven't edited it and the template changed — safe to overwrite), **conflict** (you edited it *and* the template changed), or up to date (no action).
- **added** and **updatable** files are applied automatically on startup — neither can lose anything you wrote — and reported in a dismissible note listing what changed. Only **conflict** files raise the banner and ask. Turn this off in **⚙ Settings → General → Apply safe template updates without asking** to be asked about every file as before.
- Keep your own standing instructions for AI agents in \`CLAUDE.local.md\` at the vault root rather than in \`CLAUDE.md\`. The app seeds it once and never updates it, so it never conflicts; \`CLAUDE.md\` points agents at it and it takes precedence.
- A few files — such as \`.claude/project-context.json\`, \`.claude/settings.json\`, and the \`_index.md\` files kept up to date by \`/kb-index\` — are **seed files**: they're created once when missing and never compared or overwritten again, so this check never touches your registered repos or generated indexes.
- Press **Review** on the banner to see the list and pick which files to update. **added** and **updatable** files are pre-checked; **conflict** files are left unchecked.
- **Show diff** on any file renders the unified diff between your vault's copy and the incoming template content, so you can see exactly what an update would change before applying it.
- A **conflict** file offers two resolutions: **Keep mine** — the default — leaves your file untouched and stops asking about this template version (it asks again only when the template changes further); **Replace with template (backup .bak)** saves your current content beside the original as \`<name>.bak\` and overwrites your copy with the template's version. Check the diff first.
- Files the template no longer ships are offered for removal (never pre-checked, folders left in place); **Keep** beside one keeps it and stops asking about it.
- **Update all to latest** applies everything at once — all added/updatable files, all conflicts overwritten (prior content saved as \`.bak\`), and all leftovers removed — after a single confirmation.
- Press **Later** to dismiss the banner for this session; it reappears on the next launch if updates are still pending.
- Can be disabled in **⚙ Settings → General → Check for vault template updates on startup**.`,
  },
  "memory": {
    short: "Long-term memory",
    title: "Long-term memory for AI agents",
    body: `Gives every agent session on the vault — Claude Code and OpenCode — a memory of past sessions, fully local, no cloud, no LLM. Each session's Q&A pairs are saved into \`<vault>/_ai/state/memory.db\` (SQLite), and new sessions automatically receive a time summary ("last session was N days ago") plus past conversations relevant to the current prompt, found by hybrid keyword + vector search.

- **One-time setup per machine**: run the \`/memory-setup\` skill in a Claude Code session on the vault. It installs the engine's dependencies and a local Japanese-capable embedding model (~320 MB) under \`~/.workhub/memory-engine/\`. Nothing is compiled from source, so no C/C++ build tools are required — only Node 20+. Until then the memory hooks stay silently disabled, and workhub shows a startup banner as a reminder.
- **Recall on demand**: the \`/memory-recall <keyword> [days]\` skill searches past conversations explicitly; without arguments it lists the recent timeline.
- **Privacy**: the database stores conversation text verbatim and may contain sensitive material, so setup adds it to the vault's \`.gitignore\` — it never leaves the machine with a vault backup.
- **Per-agent switches**: **⚙ Settings → Agents** has separate toggles for Claude Code and OpenCode sessions (both on by default). OpenCode support runs through the vault's \`.opencode/plugins/memory-plugin.ts\`, which uses the same engine and database.
- The setup banner can be disabled in **⚙ Settings → Agents → Notify at startup when it is not set up on this machine**.`,
  },
  "secretary": {
    short: "Secretary agent",
    title: "Your profile — fewer, better questions",
    body: `Agents ask you for a decision far more often than they need to, and when they do ask they hand you an open choice, because nothing tells them what you would have said. The vault's \`memory/identity/\` folder is the answer to both halves: \`about-me.md\` is who you are, \`decision-policy.md\` is how you decide.

- **Write your policy first**: \`memory/identity/decision-policy.md\` in the vault (seeded by the vault template) lists what an agent may do without asking, what must always come to you, how to handle the gray zone, and — under **Preferences** — the leanings a recommendation is built from. It sits under \`memory/\` rather than \`knowledge/\` because it is operational: hooks, skills and the secretary agent all read it.
- **Always on: questions arrive with a recommendation**. As soon as that note exists, every session is told to read it and to never put a bare choice to you — it works out the answer you would most likely give, offers it as the recommended option with the reason, and writes what you decide back into **Past decisions**. This costs nothing but the instruction itself, so it does not depend on the secretary switch below.
- **Optional: the secretary answers for you.** Turned on, a small subagent judges each question against the same policy and only forwards what it genuinely cannot decide. Before interrupting you, the agent consults the secretary. A **DECIDE** answer is acted on and recorded as a typed note under \`memory/notes/\` (marked \`decided_by: secretary\`, so it reads apart from a call you made yourself), so you can audit its judgement later and correct the policy where it got it wrong. An **ESCALATE** answer is filed as a question in \`_ai/comms/\` and the task is marked blocked, so the agent stops waiting on the terminal and moves on.
- **Answering**: filed questions are ordinary Markdown — open \`_ai/comms/\` in Obsidian, write under \`## Answer\`, and set \`status: answered\`. The next session on that task reads the answer before doing anything else.
- **Growing it**: the policy's *Past decisions* section is where answered questions turn into standing rules, and *Preferences* is where standing leanings go. Agents are told to append there whenever you settle something, so the note grows on its own. The more it holds, the less you are asked.
- **Switch**: **⚙ Settings → Agents → Consult the secretary before asking me** (**off by default**) controls the subagent only. Consulting it costs tokens; with the switch off nothing is consulted, but your profile is still read and questions still arrive with a recommendation. Deleting the policy note turns off both.
- **Both agent CLIs**: Claude Code sessions get this through the workhub plugin's hooks. OpenCode sessions get it through \`.opencode/plugins/secretary-plugin.ts\`, where filing a question is a tool the agent calls (\`ask_owner\`). Run \`/sync-claude-skills\` in the vault once so the secretary agent itself lands in \`.opencode/agent/\`.`,
  },
  "custom-prompt": {
    short: "Your own instructions",
    title: "Your own instructions in every agent prompt",
    body: `Every task you hand to an agent — by launching it or by copying its prompt — is sent with a generated prompt telling the agent which task to work and how to report back. **⚙ Settings → Agents → Custom prompt** lets you append your own standing instructions to it.

- Whatever you write there is added to the end of *every* task prompt, so it fits instructions that always apply (e.g. "Respond to me in Japanese", "Ask before touching CI config") rather than task-specific ones — those belong in the task's own Description.
- Line breaks are collapsed into spaces when the prompt is built, so a multi-line note stays a single valid command line. Leave the field empty to add nothing.
- It applies equally to **Copy prompt**, so a prompt pasted into another terminal by hand carries the same instructions.`,
  },
  "claude-desktop": {
    short: "Claude Desktop",
    title: "Sending a task to Claude Desktop",
    body: `An AI task carries three buttons on its card, its list row, and its editor: **Launch agent** starts the agent in a terminal (or a herdr workspace), **Copy prompt** puts the generated prompt on the clipboard for a manual paste, and **Send to Claude Desktop** opens Claude Desktop on a new session with that same prompt already filled in — the one-click form of copy-and-paste.

- **⚙ Settings → Agents → Send to Claude Desktop** picks what the button opens. *Code session* (the default) starts a Claude Code session with the vault as its folder, so the prompt behaves exactly as it does in a terminal: the same instructions, the same skills (\`task-start\`, \`task-report\`), the same working directory. *Chat* opens a plain chat instead, which has no skills and no vault access — it receives the task's Description and is meant for talking a task over, not working it.
- The first time a session opens with a folder, **Claude Desktop asks you to confirm that folder**. That prompt is part of its own link handling and cannot be skipped.
- Requires Claude Desktop to be installed — it is what registers the \`claude://\` links the button opens. Without it, the button reports that no handler is available.
- Like **Copy prompt**, the sent prompt honors the task's confirm and worktree flags, the Language setting, and your custom prompt.`,
  },
  "ink": {
    short: "Screen annotation",
    title: "Screen annotation (ink)",
    body: `Draw temporary strokes anywhere on screen — handy when narrating or reviewing.

- Double-press **Alt** and hold the second press to start drawing.
- **Alt** + **S** cycles the pen color.
- **Alt** + **C** saves what is on screen — the monitor as it was when drawing started, with your strokes on it — and copies it to the clipboard. Drawing continues, so one session can produce several captures.
- Release **Alt** to clear the strokes.
- The gesture is a *bare* double press: an **Alt** that carries a shortcut (**Alt** + **Tab** and friends) or that is held down does not count as the first press.
- It cannot fire while a window running **as administrator** is in the foreground — Windows withholds keyboard input from a normal-privilege app there. Click a normal window first.
- Captures are listed in the **Ink** tab, newest first. Clicking one opens it in a floating preview window that stays on top and can be dragged by its header and resized like any window — make it as large as the crop needs. The list updates on its own as new captures are saved.
- In the preview, drag a rectangle to crop, then copy the selection or save it beside the original as \`<name>-crop.png\` — the original is never overwritten. **Ctrl** + **C** copies, **Enter** saves the crop, **Esc** clears the selection (press it again to close the window).
- Each capture in the list can be copied to the clipboard, shown in Explorer, or deleted (deleting sends it to the recycle bin).
- Captures are written to the vault's \`attachments/ink/\`; the **Ink** tab can point them somewhere else.
- **If the gesture stops responding**, click the **keyboard** button at the right end of the tab bar, beside ⚙ Settings — it restarts the listener in one click. **⚙ Settings → General → Input listener** offers the same **Restart listener** and also shows whether keystrokes are still reaching workhub. Locking the session, reconnecting over remote desktop, or changing displays can stop Windows from delivering keys to the app. A watchdog recovers from those on its own — it even rebuilds a dead listener automatically, and the panel's **Auto rebuilds** count shows when it did. The button is for the cases it misses, so restarting the whole app is not necessary.
- The drawing layer can break on its own while keys still arrive — **Ctrl** double-press working while **Alt** double-press does nothing is the sign. workhub notices when the layer stops answering and replaces it once you release **Alt**, so the next double press works again. The restart button replaces it too.
- Can be turned off in the **Ink** tab.`,
  },
  "quick-capture": {
    short: "Quick capture",
    title: "Capture a task from anywhere (quick capture)",
    body: `A global hotkey opens a small always-on-top window that turns a copied link into an \`inbox\` task, without switching to the app. Typical use: a Slack message is about to get buried — copy its link, hit the hotkey, save, reply later.

- Press **Ctrl** + **Alt** + **N** (the default). If another app already holds that combination, workhub falls back to **Ctrl** + **Shift** + **N**.
- The window opens next to the mouse pointer, kept clear of the screen edges and the taskbar. Its size is remembered; its position is not, since it follows the pointer each time.
- The clipboard is pasted into the description **only when it is a link workhub recognizes** — a Slack message, a GitHub pull request, or a monday.com item. The task is tagged accordingly (\`slack\`, \`github-pr\`, \`monday\`).
- Any other clipboard content is left out of the form and offered on a **Paste clipboard** button instead, so unrelated text never has to be deleted by hand.
- Edit the title and description, then save — the task lands in the Tasks board with status \`inbox\`.
- The shortcut can be changed in **⚙ Settings**.
- workhub has no tray icon: closing its main window quits the app entirely, and the hotkey stops working until you relaunch it.`,
  },
  "voice": {
    short: "Voice input",
    title: "Voice input (local dictation)",
    body: `A global hotkey turns speech into text and pastes it into whatever app has focus — fully offline, no cloud, no LLM.

- Press **Ctrl** + **Shift** + **Space** (the default) to start recording; press it again to stop and transcribe, or click the stop button on the indicator. Recording auto-stops after 2 minutes.
- The first time, download a model under **Local models** in the **Voice** tab (\`tiny\`/\`base\`/\`small\` plus quantized variants; larger models are more accurate but slower). \`small-q5_1\` is a good speed/accuracy default on CPU; \`large-v3-turbo-q5_0\` is the most accurate and fast on a GPU. Transcription won't work until a model is downloaded.
- Transcription runs on the GPU (Vulkan) when one is available, and falls back to CPU automatically otherwise.
- A small indicator shows recording (with elapsed time), transcribing, or an error. While speaking, it grows into a live preview of the transcript so far, built from short chunks transcribed as you go — no need to wait for the final pass.
- By default the indicator appears next to the text cursor of the app you are dictating into, so it is where you are already looking. When no text cursor can be found (some apps don't report one), it appears next to the mouse pointer instead.
- Prefer it to stay put? Set **Indicator** in the **Voice** tab to **Fixed**: the indicator then opens where you last dragged it, or bottom-center of the primary screen.
- The transcript is copied to the clipboard, pasted into the focused app via Ctrl+V, and the previous clipboard content is restored afterward.
- Every transcript is also saved to the **Voice** tab as a safety net, even if the paste fails or its target app lost focus — the latest 50 transcripts are kept, each with copy and delete actions. Meeting auto-capture sessions skip both the history and the paste; the meeting file is their record.
- The hotkey, model, and language (auto-detect, Japanese, English) can be changed at the top of the **Voice** tab; each change takes effect as soon as you make it.
- **Meeting mode** (in the **Voice** tab) records the meeting on its own: press **Start meeting** and recording starts with it — every finished utterance is appended to the meeting file with a timestamp, no hotkey presses needed. The hotkey still works as a manual fallback. Press **Stop meeting** when the meeting ends. Stopping the indicator (or the hotkey) mid-meeting only pauses auto-capture — the panel shows it as paused and **Resume** picks it back up. Sessions restart themselves roughly every 2 minutes so long meetings stay covered; if a session fails, auto-capture halts and **Start meeting** resumes it. **Minutes prompt** copies the transcript plus instructions for decisions / action items / open questions — paste it into Claude Code or OpenCode to get structured minutes.
- **Include system audio** (in the **Voice** tab) also transcribes the other side of an online meeting through loopback capture. It is off by default; turn it on for meetings and wear headphones — with speakers, the remote voice is recorded twice (once from the system, once through the microphone). If loopback fails on a machine, recording continues with the microphone only.
- While a meeting runs, new transcript is also structured automatically about every 2 minutes into decisions / action items / open questions — see the **Minutes** view in the meeting panel (agent, model and interval live behind its ⚙ menu; 0 disables). Only new sections go to the agent, a failed run is retried next time, and there is no speaker separation: owners not named in the transcript stay "owner: TBD". **Run log** shows each run's handoff and outcome for debugging, and **Terminal** replays the same prompt in a visible terminal. Meeting files live under \`voice/meetings\` in the vault (changeable behind the panel's ⚙ menu).
- workhub has no tray icon: closing its main window quits the app entirely, and the hotkey stops working until you relaunch it.`,
  },
  "clips": {
    short: "Clips",
    title: "Paste a stored snippet anywhere (Clips)",
    body: `Snippets you retype often — addresses, boilerplate replies, commands — pasted into any app without leaving the keyboard. Same idea as clibor.

- **Double-tap Ctrl** (tap it twice on its own, quickly) to open the picker over whatever you are typing in. It opens next to the mouse pointer, kept clear of the screen edges and the taskbar.
- A tap that is part of a shortcut never opens it: **Ctrl** + **C** and friends are ignored, and so is holding Ctrl down. Only a bare double tap counts.
- Type to filter, **↑ ↓** to move, **Enter** to paste, **Ctrl** + **1**..**9** to pick one straight away, **Esc** (or clicking away) to close.
- The picked snippet is pasted into the app that had focus before the picker opened; the previous clipboard content is restored afterwards. If focus cannot be handed back, the text is left on the clipboard so you can paste it by hand.
- Edit the list in the **Clips** tab: add, edit, drag to reorder, delete, then **Save**. A snippet with no label shows its first line.
- The gesture can be switched to **double-tap Shift** or turned off in the **Clips** tab. Alt is not offered — screen annotation owns it.
- Snippets are stored in \`~/.workhub/clips.json\`.
- workhub has no tray icon: closing its main window quits the app entirely, and the gesture stops working until you relaunch it.`,
  },
  "projects": {
    short: "Projects",
    title: "Projects (the vault's project folders)",
    body: `The **Projects** tab is the screen for a *vault project* — a folder under \`projects/\` in the vault. It is not the Repos tab: a repository is a checkout on disk, a project is where that work's notes, schedules, mindmaps and deliverables live. Some projects have no repository, and some repositories have no project.

- **The list** shows every project with its task count, when it was last touched, and whether the folder matches the layout the vault's CLAUDE.md documents. **Archived** also lists the ones filed under \`archive/projects/\`.
- **Layout findings** are the point of the tab. It reports required files that are missing (\`README.md\`, \`prd.md\`, \`roadmap.md\`, \`links.md\`, \`_index.md\`), documented folders that are absent, folders nobody documented, and task deliverable notes (\`T-XXXX-…\`) sitting in the project root instead of \`deliverables/\`. Findings are reported, never fixed automatically.
- **Task project values with no folder** appears under the list when a task's \`project:\` names something \`projects/\` does not have. That field is free text, so a typo silently orphans a task — this is where you notice.
- **Repositories** links the project to the repositories registered on the Repos tab. The list is stored as \`repos:\` in the project's \`_index.md\` (created from the scaffold if the project predates it) rather than guessed from the name, because the two do not share a naming scheme. A project may legitimately span several — an app and its vault, say — and the first entry is the one an agent defaults to.
- **Shared spaces** records the team knowledge bases that live outside the vault — a network drive, a Google Drive or SharePoint folder. Each is a note in the project's \`shared/\` folder saying where the place is and how the team organises it, and each carries a **direction**: \`read-only\` (the default — never write anything there) or \`export-ok\`. The app only reads these notes: **Copy prompt** gives you a prompt to paste the location into and hand to an AI agent, which surveys the place and writes the note. A **stale** mark means the rules have not been checked against reality in three months.
- **Name and description** are edited in the detail pane and stored as \`title:\` and \`description:\` in the project's README.md. The folder slug does not change, so task \`project:\` values stay valid. An empty description falls back to the first prose paragraph of the README.
- **New project** scaffolds \`projects/NNNN-<slug>/\` from the bundled template — the same folder the Schedule and Mindmap tabs pick from. The \`NNNN-\` sort number is assigned automatically (the next multiple of ten); the slug is everything after it, and is what a task's \`project:\` names — the number is only a folder-name detail for sorting in Obsidian.
- **The Order/Name button** switches how the list is sorted: **Order** is the pinned-then-dragged position kept in \`_index.md\`, **Name** sorts by the folder itself, so numbered projects line up by their \`NNNN-\` prefix. Dragging to reorder only works in Order mode. The choice is remembered on this machine.
- **Archive** moves the folder to \`archive/projects/NNNN-<slug>/\` (keeping its number) and **Restore** brings it back. There is no delete: a project folder holds months of hand-written prose, so archiving is the only removal, and it is reversible. An archived project also disappears from the Schedule and Mindmap project pickers — its folder has left \`projects/\` — and a note left open from it is closed rather than kept pointing into the archive.
- The buttons across the top of the detail pane open the project's README in Obsidian and jump to the **Tasks**, **Schedule**, **Mindmap** and **Repos** tabs already scoped to it.`,
  },
  "schedule": {
    short: "Planning dates",
    title: "Planning dates (Schedule)",
    body: `The **Schedule** tab is a workspace for *deciding* dates — the digital version of drawing a calendar on a whiteboard — not a record of a settled plan.

- A schedule lives inside a **vault project** — a folder under \`projects/\` in the vault (not one of the repositories registered on the Repos tab). Create one from the project dropdown's **New project…** entry; while the vault has no projects at all, the middle of the tab offers a **Create your first project** button instead. The folder is scaffolded from the bundled template (README, prd, roadmap, …).
- A schedule lives in the vault as \`projects/<project-slug>/schedules/<name>.md\`. Pick a project, then **+** to create one, or open an existing note from the second dropdown. The pencil beside it renames the open schedule — the title and the file name move together. Copy the file in Obsidian to compare alternatives.
- **Calendar or Timeline** — the same note drawn two ways, switched in the toolbar. **Calendar** is the week grid below, for deciding days. **Timeline** is the long-range ("大日程") view: months across the top, phases as bands running left to right, milestones as diamonds — the shape you would draw on paper for a quarter or a year. Switching to Timeline widens a short range to about six months; **3m / 6m / 1y** set it directly. Elements are the same in both views, so a phase moved in one has moved in the other.
- **Sprints on the timeline**: press **Sprints** (Timeline only) to number the header \`S1\`, \`S2\`, … Set the day sprint 1 starts and the length in weeks; boundaries appear as vertical lines. The cadence is stored in the note itself (\`sprint_start\` / \`sprint_weeks\` in its frontmatter), so two plans of the same project can compare different cadences. Sprints are only a reading of the calendar — they never move an element or round a date.
- **On the timeline**, drag an element to move it and its edges to resize it, exactly as in the calendar; hold **Shift** while dragging to snap to whole weeks. Drag across empty chart to pick a period, then right-click to add an element or mark the day non-working. Tasks with a due date show as small dashed ticks under the axis (drag them on the calendar, where a day is wide enough to aim at).
- Weeks run continuously down the page rather than being cut into months, so a plan spanning 7/20-8/20 stays readable in one piece. A new month shows as "8/1" on the day itself, with a divider and a month label in the left gutter.
- **Today** is the date shown in a filled pill. The **Today** button next to the date range scrolls to it — and if today is outside the displayed range, it moves the range onto today first.
- **Change the displayed range without the date pickers**: over the calendar, **Shift** + **wheel** moves the range a week at a time, and **Ctrl** + **wheel** grows or shrinks it a week at a time (one week to a year). A plain wheel still just scrolls. The range is a view setting — moving it never edits the note.
- **Drag with the right button to move the range** — grab the plan and pull. On the calendar that is up and down, a week at a time; on the timeline it is left and right, following the pointer day for day. A right-click that does not move still opens the menu, so the two do not get in each other's way.
- **Drag an element** to move it — in any direction. Dragging straight down moves it a week, since the grid measures a drag in days rather than pixels. **Drag its left or right edge** to stretch or shrink it.
- **Right-click a day** to add a **bar**, **arrow**, **milestone**, or **note** there. Sweep across several days first and a bar or arrow covers the whole sweep; a milestone or note always lands on the first day.
- **A bar is a settled period; an arrow is an estimate.** An arrow covers a range of days exactly like a bar and behaves the same way when you drag or resize it, but it is drawn as a thin double-headed line instead of a filled band — so a period you are not yet committed to (a vendor lead time, a buffer, something running in parallel) reads as weaker than one you are. Switch a kind at any time in the edit panel.
- **Non-working days** are shaded and carry a small **✕** next to the date, so they stay distinguishable from a selection. Toggle one from the day's right-click menu. Weekends come from the \`weekly:\` line in the note and cannot be toggled here — edit that line to change them. Clearing one day inside a multi-day entry (say a three-day leave) takes just that day back rather than cancelling the whole entry. Every bar shows the working days it actually covers.
- **Notes are comments on a day**, like a cell comment in Excel: a small triangle in the day's corner, with the text on hover. Click the triangle to edit it.
- **Any element can carry extra lines of text** — the **Details** box in the edit panel. A note shows them on hover; every other kind shows them in its tooltip. In the file they are indented lines under the element, so they stay readable in Obsidian and in a diff.
- **Click an element** to edit its title, dates, color, and the task it links to. The editor opens in the side panel on the right — it never changes the panel's width on its own, so the calendar does not shift under your pointer. **Drag the divider** to give the calendar or the panel more room (the width lasts for the session), or hide the panel entirely with the panel button in the toolbar.
- **Stacking order is the order of the lines in the note.** When several elements share a day or overlap, the one written first sits on top. **Right-click an element → Move up / Move down** (or **Alt** + **↑** / **↓** with it selected) swaps it with the nearest element it competes with, in the calendar and the timeline alike. Elements that never overlap cannot be swapped, since nothing on screen would change.
- **Keyboard**: with an element selected, **←** / **→** move it a day, **Shift** + **←** / **→** stretch or shrink a bar or arrow, **Delete** removes it, **Esc** deselects. **Ctrl** + **Z** undoes the last change (drag, resize, create, delete) and **Ctrl** + **Shift** + **Z** redoes it.
- Tasks with a **due date** in the same project appear as dashed chips. Dragging a chip changes that task's due date on the board — it is the real task, not a copy.
- Edits save automatically a moment after you stop; the note stays open and editable in Obsidian at the same time, and changes made there appear here immediately. If the file changed underneath an edit, the save is refused and the note reloads rather than overwriting the other change.
- **HTML output** writes a single self-contained file (default: the project's \`attachments/\`) that opens anywhere and prints to A4 landscape — use the browser's "Save as PDF" to hand it around. Note text is listed in the footer, since a printed page has no hover.
- **The trash button moves the note to \`_ai/state/schedule-trash/\`** rather than erasing it, so a mis-click costs a trip to the vault folder and nothing else. It is unavailable while an AI edit is running.
- **Edit with AI**: press the ✨ button to open the box, describe the change in plain language ("push implementation back a week and shorten the integration test by the same amount") and press Ctrl+Enter. The calendar is locked while the agent works, and the ↺ button restores the note to how it was just before the run. Choose the agent and model under the ⚙ button in the toolbar.
- **Weekday names, month labels and day counts follow ⚙ Settings → General → Display language** (English or Japanese) — in the calendar and across the whole exported HTML. It is display only: a schedule note never stores localized text.`,
  },
  "mindmap": {
    short: "Mapping ideas",
    title: "Mapping ideas (Mindmap)",
    body: `The **Mindmap** tab is for thinking in branches — the shape you would draw on a whiteboard when an idea has parts, and the parts have parts.

- A mindmap lives in the vault as \`projects/<project-slug>/mindmaps/<name>.md\`, beside that project's schedules. Pick a project, then **+** to create one, or open an existing map from the second dropdown. The pencil renames it — the title and the file name move together.
- **The file is an ordinary nested bullet list.** Node positions are never stored: the map is laid out from the tree every time it is drawn. That is what keeps the note readable and editable in Obsidian, and it is why there is no "arrange" command — there is nothing to arrange.
- **Keyboard**: **Tab** adds a child of the selected node, **Enter** adds a sibling, **F2** (or a double-click) renames, **Delete** removes the node and everything under it, and the **arrow keys** walk the tree. A new node opens straight into its name box. **Ctrl** + **Z** undoes, **Ctrl** + **Shift** + **Z** redoes.
- **Drag a node onto another node** to move it — its whole subtree travels with it. A drop that would put a node inside itself is refused.
- **The circle beside a node with children** collapses and expands it; the number shown is how many children are hidden. Collapsing is only a way of looking at the map — the subtree stays in the file, and exports still include it. The map is anchored on its root, and the node you collapse stays under the pointer, so folding a branch away does not slide everything else around.
- **The width picker** decides how wide the boxes are: **Auto width** sizes each box to its own text, **Even siblings** gives the children of one parent a common width, and **Even by level** lines the whole map up in columns. The setting belongs to the note (\`node_width\` in its frontmatter), so two maps can differ and an export looks like what was on screen.
- **Right-drag pans and the wheel zooms** toward the pointer, as on the Schedule tab. **Fit** frames the whole map again. A minimap appears in the corner once the map is larger than the window.
- **Colour a branch head**, not every node: a node with no colour of its own is drawn in the nearest coloured ancestor's colour. Clicking the current colour again clears it. The side panel also links a node to a task and holds a longer note, shown on hover.
- **Sticky notes** are the always-visible kind of note: pick a node and press **Add** under *Sticky notes* in the side panel. Drag a sticky to place it, double-click it to edit (**Ctrl** + **Enter** commits, **Escape** abandons), and **Delete** removes the selected one. Its position is stored as an offset from its node, so it follows the node through any re-layout and holds still as you pan or zoom. The toolbar's sticky button hides them all at once when the map gets busy — that setting lives in the note (\`stickies\` in its frontmatter) and applies to the exports too. Deleting a node deletes its stickies.
- **mermaid** copies the map as a mermaid \`mindmap\` code block, ready to paste into a document or a README. The copy is one-way — mermaid cannot carry ids, colours or task links, so the note stays the editable form.
- **HTML** writes a single self-contained page (default: the project's \`attachments/\`) with the diagram and its mermaid source; **PNG** writes an image of the same diagram at 2x.
- **Delete moves the note to \`_ai/state/mindmap-trash/\`** rather than erasing it, so a mis-click costs a trip to the vault folder and nothing else.
- **Edit with AI**: describe the change in plain language ("group the UI ideas under a new branch") and press Ctrl+Enter. The canvas is locked while the agent works, and the ↺ button restores the note to how it was just before the run. Choose the agent and model under the ⚙ button in the toolbar.
- Edits save automatically a moment after you stop; the note stays open and editable in Obsidian at the same time, and changes made there appear here immediately. If the file changed underneath an edit, the save is refused and the note reloads rather than overwriting the other change.`,
  },
  "docs": {
    short: "Reading shared Markdown",
    title: "Reading shared Markdown (Docs)",
    body: `The **Docs** tab reads Markdown that lives outside the vault — a Google Drive network drive the team keeps its notes on, a share on the file server, any folder you can reach from this PC.

- **Why not just open it in Obsidian?** Opening a shared folder as a vault writes an \`.obsidian/\` folder into it, and everyone's workspace state then collides. This tab never writes into a document folder — no index, no cache, nothing. It reads, and that is all it can do.
- **Add a folder** with the folder button on the tab itself (not in Settings — a folder is what the tab is for). The path is stored **in the vault**, so a second PC that clones the vault gets the same list.
- **The pencil button edits one folder** — its name and its path. The path is recorded in the vault, so a PC that clones the vault gets the same folder; if that PC mounts the share elsewhere, correct the path there.
- **The tree loads one folder at a time**, when you open it. On a Drive share where files are placeholders until read, a whole-tree scan would stall the tab — so nothing is scanned until you look at it. There is no file watcher either: press **↻** to pick up what a colleague added. Refreshing re-reads the tree without collapsing it, and the button beside it collapses every folder at once.
- **Mermaid diagrams render**, and images embedded by a document are shown — both the Markdown \`![](file.png)\` form and Obsidian's \`![[file.png]]\`. Relative paths resolve against the document. An image pointing at an \`https:\` URL loads once the gear button's **Load images from https: URLs** is on; off, it reads as unreadable. Fetching one announces the read to whoever serves it, so the switch is off by default.
- **PlantUML diagrams render once a server is set.** \`\`\`plantuml\` (or \`\`\`puml\`) blocks are drawn by a PlantUML server, which receives each diagram's source. Until you enter one with the **gear button** on the tab, they stay code and nothing is sent. The public \`https://www.plantuml.com/plantuml\` works; a server your team runs is the better home for a team's documents. The setting is stored in the vault, like the folder list.
- **Shortcuts keep the documents you keep coming back to.** Right-click a file or a folder and choose **Add to shortcuts**: it is listed at the top of the sidebar, and dragging by the grip reorders the list. The list is stored in the vault beside the folder list, so a second PC gets it back, and each folder shows only its own shortcuts. Clicking a shortcut opens the tree down to it.
- **Recent files** lists the last five documents you opened, per folder. It is this PC's own history — it is not stored in the vault — and the x beside the heading clears it.
- **A file list beside the tree, optionally.** The gear button's **File list beside the tree** splits the sidebar the way Obsidian's Notebook Navigator does: folders on the left, the files of the folder you pick on the right. It is off by default, and off the sidebar is one tree holding both. With it on, a folder's name selects it and its chevron expands it.
- **The keyboard walks the tree.** Click a row, then **↑** / **↓** move between rows, **→** opens a folder (and again steps into it), **←** closes it or goes up a level, and **Home** / **End** jump to the ends. **Enter** is what opens a document — moving the cursor deliberately does not, because reading a file per keypress off a network share is unusable.
- **Reading a wide document.** The preview header zooms the text (**Ctrl+wheel** too), and its width button drops the reading line length so the document uses the whole pane. Both are remembered. The **window button** opens the whole document in a window of its own, and hovering a diagram or an image shows a button — or double-click it — that opens just that figure in a window where the **wheel zooms around the cursor** and **dragging pans** (any mouse button; a right-drag that moved the figure does not open the context menu). The divider between the tree and the preview remembers where you left it.
- **Picking a folder reads it afresh**, so a share that was offline a moment ago is tried again rather than remembered as broken. A folder that is not reachable offers **Try again** as well.
- **HTML written inside a document renders** — \`<details>\`, \`<kbd>\`, \`<img width="300">\`, \`<br>\` and the like — after being cleaned to GitHub's rules, so scripts and event handlers in a shared note never run.
- **Callouts render as coloured boxes** — Obsidian's \`> [!note]\` / \`> [!warning]\` (with a custom title, and \`-\` / \`+\` to fold), NotePM's \`:::note info|warn|alert\` and Zenn's \`:::message\` / \`:::message alert\` / \`:::details Title\`. Click a foldable callout's (or a details block's) title to open or close it. Code blocks are not syntax-highlighted.
- **HTML files preview as a page**, in a sandboxed frame with **scripts switched off**. Relative images and stylesheets are loaded, and \`https:\` images once the gear button's **Load images from https: URLs** is on; nothing else is fetched from the web. A page that needs its scripts (an interactive report) will look incomplete here — open it in the browser instead.
- **Everything in the folder is listed**, not just Markdown — names include the extension. Clicking a \`.md\` or \`.html\` file previews it here; clicking anything else (a PDF, a spreadsheet) opens it in whatever app the OS associates with it. Dot-folders like \`.obsidian\` and \`.git\` stay hidden.
- **Right-click a file or folder** for **Open with default app** (files only — the way to see a previewable file in the browser or your own editor), **Show in Explorer** (selects it in its folder), **Add to shortcuts** and **Copy path** (the absolute path, backslashes and all). The preview header carries the first two as buttons.
- **Copy several paths at once.** **Ctrl+click** files to pick them one by one, or **Shift+click** to pick the run between two — picking does not open them. Right-click any picked file and **Copy N paths** puts them all on the clipboard, one per line, in the order they are listed. A plain click, **Esc**, or moving to another folder drops the pick.
- **Editing is not offered — notes and a prompt are.** The tab never writes into a document folder, so there is nothing to save here. Instead: select some text in the preview, **right-click**, and write what should change. The note is pinned to that passage, which is underlined from then on; click it again to edit or delete it. The **Notes** section in the sidebar lists every note on the open document, and its copy button puts them all on the clipboard as a request for an AI agent — the file's path, the line and the quote for each note, and two standing instructions: read the file as it is now, and show the change as a diff and get it approved before writing. Paste that into Claude Code or OpenCode and the agent does the editing. The approval step is not conditional on the folder being shared: a document folder has no git in it either way, so an overwrite has no undo. Notes are this PC's own (like Recent files) and are meant to be thrown away once they are in a prompt; if the document changes underneath them, the section says so.`,
  },
  "inbox": {
    short: "Inbox",
    title: "Notes waiting in the vault (Inbox)",
    body: `The **Inbox** tab shows the raw notes sitting in the vault's \`inbox/\` folder — the ones you dropped there to file later. Until now they were visible only in Obsidian, so anything you forgot about simply stayed forgotten.

- The list is exactly what **Vault tidy** considers: \`README.md\` is ignored, and so is every folder listed under **Inbox tab → ⚙ → Vault tidy → Exclude folders** (\`inbox/_wip/\` by default). A note you keep out of tidy's way stays out of this list too.
- Each row shows when the note was last edited and how long it has been sitting. The age turns amber once it passes tidy's age threshold — that is the point at which a tidy run would act on the note.
- A **proposal** badge means a tidy run looked at the note, could not decide where it belonged, and parked its suggestion. Select the note to read the proposed destination and the reason under the preview.
- The tab is read-only for now: file the note in Obsidian (the gem button opens it there). Acting on a proposal from inside workhub comes later.
- The list is re-read every time you open the tab, so changes made in Obsidian show up on your next visit.`,
  },
  "persona": {
    short: "Persona",
    title: "Changing how agents talk to you (Persona)",
    body: `The **Persona** tab picks the character and tone every new Claude Code session starts with. It only appears when the \`persona\` plugin is installed — the tab reads the characters that plugin ships, so with no plugin there is nothing to show.

- Install it once with \`claude plugin install persona@workhub-marketplace\`, then reopen the tab (or press its refresh button).
- **Built-in** characters come from the plugin; **Custom** ones are yours. Pick a character on the left, read what it is and how it speaks on the right.
- **Level** is how hard the character compresses its answers. Each character names its own levels, and the tab shows that character's description of each one — they are not interchangeable between characters.
- Changes apply **from the next session**. Sessions already open keep the character they started with, on purpose: the flag they re-read every turn is shared by every running session, so changing it here would rewrite the tone of a conversation in progress.
- To make your own character, run \`/persona-new <id>\` in Claude Code and answer its questions. It writes \`~/.claude/personas/<id>/character.md\`. Keep custom characters there — anything placed inside the plugin's own folder is lost on the next plugin update.
- A **Custom** character can be deleted from its own page: the \`Delete\` button sends \`~/.claude/personas/<id>/\` to the recycle bin after a confirmation, so it can be put back from there. Built-in characters have no delete — they belong to the plugin and would return with its next update. Deleting a custom character that shares an id with a built-in one brings that built-in back into the list.
- If \`PERSONA_DEFAULT\` is set in your environment, it beats the saved setting and the tab says so. Unset it to make the tab effective again.`,
  },
  "plugins": {
    short: "Plugins",
    title: "Keeping the plugins straight (Plugins)",
    body: `The **Plugins** tab answers three questions about the \`workhub-marketplace\` plugins on this machine: how much the harness needs each one, which of them are switched on here, and whether what is installed is behind the marketplace.

- Each plugin has a **tier**, decided by what breaks without it. **Required** means an app feature or an agent launch stops working — only \`workhub\` qualifies: the app names its skills in its own launch prompts, and its harness hooks are the sole readers of the project list the app writes. **Recommended** means nothing breaks but the harness is poorer for it — \`engineering\` sits here, because how a team commits and branches is that team's own call. **Optional** is taste or tech stack. The tiers come from the marketplace's own \`catalog.json\`, not from this app, so they stay right as the marketplace changes. The list is ordered by what needs a decision first, then by tier.
- **Scope** is where a plugin is installed. \`user\` writes to \`~/.claude/settings.json\` and is the default: a plugin is switched on per machine and then works from any directory. \`project\` writes to the vault's \`.claude/settings.json\`, for the rarer case of wanting a plugin in one repository and nowhere else. \`either\` follows wherever it is already on, and falls back to \`user\`.
- **Update marketplace** refreshes the local clone every "latest version" is compared against. Without it the tab compares against whatever was cloned last — so a plugin can look up to date when it is not.
- The **switch** on each row adds or removes one \`enabledPlugins\` key. The **Update** button runs \`claude plugin update\` for that plugin at its scope. Both need the Claude Code CLI on PATH.
- Everything here takes effect **in the next Claude Code session** — restart any session that is open.`,
  },
  "tidy": {
    short: "Vault tidy",
    title: "Vault tidy (automatic housekeeping)",
    body: `Keeps the vault easy for AI to search: files stale notes out of \`inbox/\` and refreshes the \`tasks/archive/_index.md\` summary — by launching an agent headlessly (no terminal window).

- Turn it on in **Inbox tab → ⚙ → Vault tidy**. It is **off by default**; leave it off if you drive the same routine from a Claude Desktop routine instead.
- The app decides *whether* there is work with a cheap mechanical scan (no tokens) — a run only starts when \`inbox/\` has a note older than the age threshold, or the archive index has drifted.
- **Schedule** is "first run at" + "run every N hours" (24 = daily, 168 = weekly). Because it counts from that anchor, a run missed while the app was closed is caught up on the next launch.
- Notes you're still writing: keep them in **\`inbox/_wip/\`** (or any folder listed under "Exclude folders") — tidy never touches those.
- Files that need human judgement (a new folder, a rename, unclear classification) are **not** filed silently. They surface as a single **\`#tidy-review\`** task on the board with a proposed plan per file — edit the proposals, then assign the task to an agent to execute them, and read the per-file proposal itself on the **Inbox** tab. Deferred files don't retrigger tidy runs until you touch them again.
- **Agent / Model** pick which CLI (Claude Code or OpenCode) and model run the routine, just like a task.
- **Run now** triggers it immediately, even when the schedule is off. If a run stalls or fails, you get a desktop notification.
- The routine runs with the same auto-approve permission mode a task-card agent launch uses, so it doesn't sit waiting on prompts. An operation it isn't allowed to do is skipped rather than asked about, which can leave a run half-finished.
- **Resume session** picks up exactly where a run left off — after a failure, a stall, a killed process, or an app restart. The session id is shown next to the run status with a copy button, and is also written into the run log under \`_ai/logs/tidy/\`, so you can resume from a terminal yourself with \`claude --resume <id>\`. (OpenCode mints its own session ids, so there Resume just reopens the agent in the vault.)`,
  },
  "recurring": {
    short: "Recurring tasks",
    title: "Recurring tasks",
    body: `Rules that create a task for you on a schedule — a daily standup note, a weekly review, a monthly report. Set them up with the **Recurring** button on the **Tasks** tab (they are task content, so they live next to the board rather than in Settings).

- **Repeat** is daily (every N days from the start date), weekly (pick the weekdays), or monthly (pick the day; it is clamped to the last day of shorter months), plus a time of day. Times are this machine's local clock.
- The generated task uses the rule's title, status, assignee, project, priority, model and body, so it lands on the board ready to work. **Due offset** sets \`due\` to the occurrence date plus N days; leave it empty for no due date.
- Rules are checked when the app starts and every few minutes after that, so a machine booted at 10:00 still gets its 09:00 task. Only the **latest** missed occurrence is created — a week with the app closed produces one task, not seven.
- **Skip while the last one is still open** is the "don't add it if it's already there" switch: while an earlier task from the same rule is not done, the occurrence is skipped instead of putting a second copy on the board.
- Every generated task carries the tag \`recurring/<rule-id>\` (e.g. \`recurring/R-001\`). That tag is how the app recognizes its own tasks — keep it if you edit the task in Obsidian.
- **Run now** saves the rules and then creates whatever is due right away.`,
  },
  "diagnostic-log": {
    short: "Reporting a problem",
    title: "Reporting a problem (the diagnostic log)",
    body: `workhub keeps its own log of what it did — errors, timings, which fallback a feature took, where a window was placed. The packaged app has no console window, so this log is the only trace a problem leaves behind.

- **⚙ Settings → General → Diagnostic log** shows the most recent lines, with **Copy** to put them on the clipboard for a bug report and **Open folder** to reach the file itself (\`~/.workhub/logs/workhub.log\`).
- Turn on **Auto-refresh** while you reproduce a problem to watch the lines arrive; leave it off otherwise.
- The file rotates at 1 MB and keeps one previous copy, so it never grows without bound. Nothing configures it, and nothing turns it off — a log you had switched off on the day it mattered would be worthless.
- It records **what the app did, never what you wrote**: no dictated text, no clipboard contents, no note or task bodies. Copying it into an issue does not leak your notes.
- Crashes land here too. If a feature dies silently, the log is where its panic — with the file, line and thread — was recorded.`,
  },
};
