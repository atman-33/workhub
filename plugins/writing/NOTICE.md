# NOTICE

The `writing` plugin's `natural-japanese` skill is a selective port of
**natural-japanese** by coji, used under the MIT License.

- Upstream project: https://github.com/coji/natural-japanese
- Ported from: upstream v1.5.0 (`9a78a42`)
- Derived from: `skills/natural-japanese/SKILL.md` (procedure, adapted),
  `references/` except `diagnose.md`, `references/doctypes/` (all five),
  and `assets/style-profile-template.md`.

What this plugin changed:

- Scripts (`scripts/`, Python + sudachipy) are not bundled: this
  repository's plugin authoring rules ship Node ESM only, never Python.
  Inspection runs on `references/manual-checklist.md` instead — the
  upstream's own no-script fallback, now the primary path.
- The `score` (diagnose) mode is dropped: its scoring formula is defined
  over lint findings, which do not exist here. `references/diagnose.md`
  is not bundled.
- `SKILL.md` keeps its Japanese trigger phrases: they are what makes the
  skill discoverable from a Japanese request (the same reason `persona`
  keeps its own).
- Mentions of `lint.py` and other scripts remaining inside `references/`
  are upstream provenance notes; the procedure in `SKILL.md` takes
  precedence.

The original license text follows.

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
