---
paths:
  - "vault-template/**/*.base"
  - "src-tauri/src/tasks.rs"
---

# `.base` files are rewritten by Obsidian, so byte-equality never holds

Obsidian normalises a `.base` file whenever the view is opened or touched. A
Base scaffolded from `vault-template/templates/project/backlog/_backlog.base`
comes back looking like this within one session:

- quoted scalars lose their quotes (`- 'type == "backlog"'` → `- type == "backlog"`)
- keys are re-ordered (`groupBy` moves above `order`)
- `columnSize:` appears, holding pixel widths
- `order:` grows the columns the user dragged into the table

None of that is a deliberate edit, but all of it changes the bytes. Every one
of the vault's project Bases differed from the rendered template this way
after T-0263 corrected them **to** the template by hand.

**Consequences for template sync** (`src-tauri/src/tasks.rs`):

- A `.base` listed in `.template-policy.json`'s `project_sync` normally
  classifies as `Conflict`, not `Updatable`. That is the designed outcome:
  the owner sees it in the update banner, reads the diff, and chooses. Do not
  "fix" it by loosening the comparison.
- A freshly scaffolded project's Base does match until Obsidian touches it, so
  `adopt_matching_baselines` records a baseline and the next update is quiet.
  The behaviour degrades gracefully; it is not uniform.
- Comparing normalised YAML instead of bytes would need a YAML parser. This
  crate has none on purpose (frontmatter is hand-parsed, see the module doc of
  `tasks.rs`), and `serde_yaml` is unmaintained. It was considered for T-0265
  and rejected.

**Do not put explanatory YAML comments in a `.base` file.** Obsidian's Bases
parser is not verified to preserve or even accept them, and a Base that fails
to parse renders zero rows *silently* — the exact failure T-0272 fixed.
Rationale belongs in a Rust doc comment or a PR body.
