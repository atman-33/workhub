---
name: team-share
description: Put this session's research, comparison, or investigation into a team-comms thread as a summary plus attachments, so teammates' agents can read it instead of being handed a document. Use when work worth sharing with the team comes out of a session, or when the user would otherwise export a document and send it.
---

# Share research into a thread

This is the skill the plugin exists for. What used to be "export it, send it,
they paste it into their agent" becomes "it is in the thread".

## Steps

1. **Pick the thread.** The focused one by default; otherwise
   `comms list` / `comms search`. No thread fits → `team-open` first.

2. **Split the material in two.** This split is the whole point:

   | Goes in the post | Goes in an attachment |
   |---|---|
   | What you found, in one or two lines | The full research output |
   | The recommendation and why | Comparison tables, long reasoning |
   | What is still open | Diagrams, exports, generated files |

   If the full report goes in the post body, every agent on the thread reads
   all of it every time — the handover you removed comes straight back as
   token cost. The summary is what lets a reader decide whether to open the
   rest.

3. **Write the attachment to a real file** (Markdown, SVG, PDF, HTML — a
   scratch path is fine), then post:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" post \
     --kind share --summary "<what you found, and what you recommend>" \
     [--body-file <path>] [--attach <path>]... [--thread <id>] [--mention <agent-id>]
   ```

   Attachments land in a folder beside the post and are immutable like it.

4. **Keep attachments sensible.** Around 10 MB per file; anything larger goes
   elsewhere on the drive with a link in the body. No build output, no video.

5. **Report where it went**, and remind the user that people only see it if
   they are following the thread — mention someone, or tell them.

## Rules

- Share what a teammate can act on, not a transcript of the session.
- Never attach credentials, tokens, or customer data. The comms space is as
  visible as the shared drive it sits in.
- Attachments are immutable, same as posts: a corrected report is a new post.
