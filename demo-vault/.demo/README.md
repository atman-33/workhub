# Demo mode

Support files for taking the screenshots used in the repository `README.md`.
They are not part of the vault's content — Obsidian hides this folder, and the
app ignores it.

| File | What it is |
|---|---|
| `config.sample.json` | A workhub config pointing at this vault and at three throwaway repositories. `{VAULT}` and `{REPOS}` are substituted by the script. |
| `demo-mode.mjs` | Swaps your real `~/.workhub/config.json` for the demo one and back. Node 20+, no dependencies. |

See [`docs/screenshots.md`](../../docs/screenshots.md) for the full capture
procedure.
