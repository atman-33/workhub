# NOTICE

The `writing` plugin's `natural-japanese` skill combines two MIT-licensed
projects. Both are rewritten for this repository rather than vendored.

## natural-japanese by coji

- Upstream project: https://github.com/coji/natural-japanese
- Ported from: upstream v1.5.0 (`9a78a42`)
- Derived from: `skills/natural-japanese/SKILL.md` (procedure, adapted),
  `references/` except `diagnose.md`, `references/doctypes/` (all five),
  and `assets/style-profile-template.md`.

What this plugin changed:

- Upstream's Python scripts (`scripts/`, sudachipy) are not bundled: this
  repository's plugin authoring rules ship Node ESM only, never Python. The
  review runs on `references/manual-checklist.md`, with the Node
  `scripts/lint.mjs` pointing at the surface marks it can catch.
- The `score` (diagnose) mode is dropped: its scoring formula is defined over
  upstream's lint findings, which do not exist here.
- Upstream's corpus calibration reports are not bundled. Statements in
  `references/` that rested on them were reworded or removed.
- `SKILL.md` keeps its Japanese trigger phrases: they are what makes the skill
  discoverable from a Japanese request (the same reason `persona` keeps its
  own).

## yomiyasu by nanaism

- Upstream project: https://github.com/nanaism/yomiyasu
- Studied at: v1.0.2
- Ideas taken, restated in this plugin's own words and conventions: the
  meaning-preservation rule (claim, weight, strength of assertion, function of
  the sentence) and the no-addition rule (`references/meaning-preservation.md`);
  the rewrite procedure, output format and per-genre notes
  (`references/rewrite-procedure.md`); the vocabulary catalogue, merged into
  `references/forbidden-patterns.md`; and the lint and diff checks, rewritten
  in Node as `scripts/lint.mjs` and `scripts/diff.mjs`.

What this plugin changed:

- The two scripts are reimplemented in Node ESM, with a few corrections: a
  closing-phrase pattern that could never match is fixed, an em-dash check the
  Python lint did not have is added, ordinary words that are also AI favourites
  are reported as info rather than warn, and there is no score (a number
  invites rewriting until it reads 100).
- Not carried over: the corpus-building and benchmark scripts, `tests/corpus`
  and `evals/` (development material, and the benchmark quotes government text
  under a separate licence), and the academic-citation prose.
- The skill stays a single skill. yomiyasu warns that stacking two style skills
  makes their instructions interfere, so the two sources are merged into one
  here instead of being installed side by side.

The original license texts follow.

---

MIT License

Copyright (c) 2026 coji

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

---

MIT License

Copyright (c) 2026 nanaism

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
