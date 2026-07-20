---
description: Keep the team-ops design document in sync with plugin changes
paths:
  - "plugins/team-ops/**"
---

# team-ops design document

`plugins/team-ops/docs/design.html` is the plugin's authoritative design
document (folder layout, config model, skills/hooks catalog with their
read/write contracts, information-flow and daily-operations diagrams). It was
reviewed and approved by the owner (task T-0053).

- **Any change to the team-ops plugin that alters behavior described there —
  folder layout, config schema, a skill/hook's inputs or outputs, scripts,
  the operations cycle — must update `docs/design.html` in the same PR.**
  Doc-only or wording-only plugin fixes don't need a design-doc edit.
- Update the affected section (and its diagram, if the flow changed), not
  just the text: the diagrams are the part the owner reviews.
- The design doc is a self-contained HTML file (inline CSS/SVG, no external
  assets); keep it that way.
