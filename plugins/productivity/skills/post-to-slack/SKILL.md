---
name: post-to-slack
description: Post a message to a Slack channel, resolving channel/user names to IDs and adding an optional @mention or thread reply. Use when the user wants to post, share, or notify something in Slack, or when another skill needs to deliver its output to a Slack channel.
disable-model-invocation: true
---

# Post to Slack

Resolves a channel name (or a user name for a mention) to its Slack ID
before posting — the Slack MCP connector's send/search tools need IDs, not
display names, and IDs are not stable across workspaces.

## Steps

1. Determine the message body and the target channel. If the caller (a
   direct user request, or another skill such as `report-pbl-progress`)
   already gives an explicit channel ID (`C...`) and/or an already-resolved
   mention (`<@U...>`), skip straight to step 4 — don't re-resolve what's
   already unambiguous.
2. If the channel is given by name rather than ID, resolve it with the Slack
   MCP connector's `slack_search_channels` tool and take the matching
   channel's ID. If more than one channel plausibly matches, ask the user
   rather than guessing.
3. If a mention is wanted and given by name rather than user ID, resolve it
   with `slack_search_users` and format it as `<@USERID>` inline in the
   message text — Slack does not render `@name` as a mention, only the raw
   `<@ID>` form works.
4. Post with `slack_send_message` (`thread_ts` for a thread reply,
   `reply_broadcast` to also surface a thread reply in the channel). Return
   the message's permalink to the caller.

## Reference

### Failure modes

- **Channel not found**: `slack_search_channels` found no match — confirm
  the exact channel name with the user; don't guess a close match.
- **User not found**: same for `slack_search_users` when resolving a
  mention.
- **Message too long**: 5000 characters per text element — split into a
  thread reply rather than truncating silently.
- **Can't post to Slack Connect (externally shared) channels**:
  `slack_send_message` fails outright for these; tell the user rather than
  retrying.
- **Slack Canvas unavailable**: `slack_create_canvas` returns
  `not_supported_free_team` on free-tier workspaces. This skill never uses
  Canvas for that reason — if a caller wants a richer document than a
  single message, that's out of this skill's scope.

### Reusable from other skills

This skill is intentionally generic — it has no PBL/monday-specific logic.
Any skill that produces a summary a human should see in Slack (e.g.
`report-pbl-progress`) should hand this skill the message text and target
channel rather than calling the Slack MCP tools directly itself. This also
keeps unattended/scheduled callers working: a caller that already knows its
channel and mention can drive this skill's steps straight through without
any ambiguity to resolve.
