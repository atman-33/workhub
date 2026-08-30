# NOTICE

The persona plugin is a derivative work of **genshijin** by InterfaceX-co-jp,
used under the MIT License.

- Upstream project: https://github.com/InterfaceX-co-jp/genshijin
- Derived from: the `genshijin` skill set, its SessionStart / UserPromptSubmit
  hooks, the statusline badge, the `genshijin-commit` / `genshijin-review` /
  `genshijin-compress` / `genshijin-stats` / `genshijin-crew` skills, the three
  crew subagents, and the `genshijin-shrink` MCP middleware.

What this plugin changed:

- One engine with pluggable character files, instead of a single hard-coded
  persona. Compression rules, boundaries, subskills and agents are
  character-agnostic and shared.
- State became two axes (character x level) and is persisted, so a switch
  survives into later sessions.
- User-defined characters live outside the plugin directory so they survive
  plugin updates.
- Scripts are Node ESM throughout, per this repository's plugin authoring rules.
- Compression of files is performed by the model against the shared rules, with
  deterministic pre-flight refusal and post-hoc validation in Node, replacing
  the upstream Python CLI.

## Bundled characters

Character files describe a manner of speaking and reasoning. They contain no
quoted lines, artwork, logos or story material, and each file forbids bringing
that material into a conversation.

- `holmes` is drawn from Arthur Conan Doyle's Sherlock Holmes stories, which
  are in the public domain.
- `noctis`, `lunafreya` and `ignis` take their manner from characters in
  Final Fantasy XV. Square Enix owns those characters; this plugin is not
  affiliated with or endorsed by Square Enix.
- `genshijin` comes from the upstream project named above.

The original license text follows.

---

MIT License

Copyright (c) 2026 InterfaceX-co-jp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
