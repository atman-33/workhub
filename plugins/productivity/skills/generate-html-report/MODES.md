# Modes

Detail for each mode named in [SKILL.md](SKILL.md). Read only the section for the mode you picked.

## Spec / plan

A web of pages beats one long Markdown plan: start broad, then narrow.

1. Brainstorm several distinctly different approaches and lay them out side by side in a grid (one column per option), each labeled with the tradeoff it makes.
2. Once a direction is picked, expand it: mockups, data-flow diagrams, key code snippets.
3. Write the final implementation plan as its own HTML page once the user is happy with the direction, so a fresh session can be handed just that file to implement from.

Use for: exploring alternative implementations, exploring multiple visual designs, an implementation plan meant to be handed to another session.

Example prompt shape: "Generate N distinctly different approaches — vary layout/tone/density — laid out in a single HTML file in a grid so I can compare them side by side. Label each with the tradeoff it's making."

## Code review / PR explainer

Render the actual diff, not a description of it — inline margin annotations, severity-coded findings (color), and a flowchart for any logic that isn't obvious from the diff alone (e.g. streaming, backpressure, state machines).

Use for: creating a PR, reviewing a PR, explaining a PR to someone else, understanding an unfamiliar piece of code.

Example prompt shape: "Create an HTML artifact that describes this PR. I'm not familiar with the [X] logic so focus there. Render the actual diff with inline margin annotations, color-code findings by severity."

## Design / prototype

HTML is the sketching surface even when the target implementation is something else entirely (React, Swift, etc.) — HTML is fast to iterate on and expressive for layout, color, and motion. Use real sliders/knobs/inputs so the user can tune values live rather than describe them in text, then let them copy the values that worked back into a prompt.

Use for: design-system artifacts, adjusting components, visualizing a component library, prototyping animations.

Example prompt shape: "Prototype [interaction]. Create an HTML file with sliders/options to try different values, and a copy button for the parameters that worked."

## Research / status report

Synthesize across sources — codebase, git history, connected MCPs (Slack, Linear, etc.), the web — into one readable document. Use SVG for any diagram that helps (architecture, flow, timeline). Optimize for someone reading it once: lead with the answer, put a "gotchas" or caveats section at the end rather than interleaving it.

Use for: explaining how a feature/system works, summarizing a topic, a status report to a manager, an incident report, a diagrammed explainer.

Example prompt shape: "Read the relevant code and produce a single HTML explainer: a diagram of the [flow], the key code snippets annotated, and a gotchas section at the bottom. Optimize it for someone reading it once."

## Editing interface

A throwaway, purpose-built editor for one specific piece of data — not a reusable tool. The one rule that makes this mode work: always end with an export ("copy as JSON", "copy as Markdown", "copy diff") that turns whatever the user did in the UI back into something they can paste into a prompt.

Use for: reordering/triaging/bucketing items (tickets, test cases, feedback), editing structured config (feature flags, env vars, constrained JSON/YAML) with live validation, tuning a prompt/template with live preview, curating a dataset (approve/reject/tag rows), annotating a document/transcript/diff, picking values that are painful to express in text (colors, easing curves, crop regions, cron schedules, regexes).

Example prompt shape: "Make me an HTML file with each item as a draggable card across [columns]. Pre-sort by your best guess. Add a 'copy as Markdown' button that exports the final result with a one-line rationale per item."
