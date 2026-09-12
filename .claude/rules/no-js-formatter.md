---
paths:
  - "src/**"
  - "*.json"
  - "*.ts"
---

# Do not run a JavaScript formatter over this repo

There is no Prettier or Biome config here, and no `format` or `lint` script in
`package.json`. The frontend is hand-formatted at roughly 100 columns, which is
**not** what any formatter does by default.

So `npx prettier --write` is never a tidy-up — it is a rewrite:

- at Prettier's default 80 columns it rewraps lines you never touched, and the
  diff buries the actual change;
- at `--print-width 100` it still disagrees on enough cases to rewrite files
  that were not part of the change at all (T-0299 hit five: `docs-file-list`,
  `docs-settings-dialog`, `docs-tree`, `figure-viewer`, `docs-view`);
- it also rewrites CRLF to LF, so the whole file can read as changed.

Match the surrounding code by hand instead. If a formatter is ever wanted here,
it is its own change — config, a script, and one commit that reformats
everything — not a side effect of a feature branch.

CI enforces `cargo fmt --check` on the Rust side only. There is no frontend
formatting check, which is exactly why a stray formatter run passes CI while
making the change unreviewable.
