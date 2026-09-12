---
description: Keep the team-comms design document in sync with plugin changes
paths:
  - "plugins/team-comms/**"
---

# team-comms design document

`plugins/team-comms/docs/design.html` is the plugin's authoritative design
document (the conflict-avoidance invariants, the shared-folder layout, the post
format, the opt-in notification model, and the component contracts). It was
reviewed and approved by the owner (task T-0287).

- **Any change to the team-comms plugin that alters behavior described there —
  the folder layout, a filename pattern, the post schema, what the hook injects
  and when, a CLI command's contract — must update `docs/design.html` in the
  same PR.** Doc-only or wording-only plugin fixes don't need a design-doc edit.
- The five invariants (P1–P5 in §2) are the reason the plugin is safe to point
  at a cloud-synced folder. **A change that weakens one of them is a design
  change, not an implementation detail** — it needs the owner, and the document
  has to say what replaced it. The usual pressure is a small convenience:
  rewriting a post in place, one shared index file, a counter instead of a
  random suffix. Each of those reintroduces exactly the class of failure the
  design removes, and the symptom (a sync conflict copy, days later, on
  somebody else's machine) never looks like the change that caused it.
- The design doc is a self-contained HTML file (inline CSS/SVG, no external
  assets); keep it that way.
- The Japanese original the owner reviewed lives in the workhub vault at
  `projects/0010-workhub/backlog/B-015-team-comms-plugin/020-詳細設計.html`.
  It is the record of the decision, not a second source of truth: when the two
  disagree, `docs/design.html` describes the plugin and the vault note
  describes what was agreed.
