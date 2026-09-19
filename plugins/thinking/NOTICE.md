# NOTICE

The `thinking` plugin's `teach-back` skill was written for this repository.
Its procedure borrows ideas from the following MIT-licensed skills. No upstream
text, scripts or assets are bundled; the skill is a rewrite.

| Upstream | Commit read | Idea taken |
|---|---|---|
| [rodbv/socratic-skills](https://github.com/rodbv/socratic-skills) (`quiz-me`) | `dda051c` | One question at a time; a follow-up before a correction; grade the *why*, not the *what* |
| [haunguyendev/feynman-skill](https://github.com/haunguyendev/feynman-skill) | `67571c7` | `map` (a ranked list of questions for large material); `break` (the assumption whose failure takes everything with it) |
| [malkreide/socratic-method-skill](https://github.com/malkreide/socratic-method-skill) | `7bf0d1d` | A taxonomy of question types; scaffolding when stuck; never state the answer and ask for agreement |
| [jrobador/feynman-code-tutor](https://github.com/jrobador/feynman-code-tutor) | `d83dbc1` | Counterfactuals against fluent but hollow explanations; restating without jargon; closing on recall rather than a summary |

What this plugin changed:

- The questions are anchored to a source document, with numbers, definitions,
  background and figures as their own axes, which none of the upstreams have.
- Questions the document cannot answer are recorded as the document's gaps,
  separately from the reader's.
- Modes, therapy/legal personas and the HTML-lesson generator are not carried
  over. No scripts are bundled.

`ladder` is original to this repository.

The upstream license text follows.

---

MIT License

Copyright (c) 2026 Rodrigo Vieira
Copyright (c) 2026 haunguyendev
Copyright (c) 2026 Hayal Oezkan
Copyright (c) 2026 Joaquin Robador

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
