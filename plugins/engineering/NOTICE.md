# NOTICE

Most of the `engineering` plugin was written for this repository. The
exceptions are listed below; each was rewritten to this repository's
conventions rather than vendored, and each upstream project is used under the
MIT License.

## `skills/system-design`

### OpenSpec — https://github.com/Fission-AI/OpenSpec

Copyright (c) 2024 OpenSpec Contributors. MIT License.

Source of the design document set and the rules for what goes in each file:
the `spec-driven` schema's proposal / specs / design artifacts, their section
structure, the capability contract between proposal and specs, the
requirement/scenario format (SHALL/MUST, `#### Scenario:` with WHEN/THEN, the
ADDED/MODIFIED/REMOVED delta sections), and the rule that an open question is
only for an unknown that can be deferred without changing the specs, the
approach or the task breakdown.

Not carried over: the `openspec` CLI and its change/store/archive lifecycle,
`tasks.md`, the `specs/` subfolder layout, and spec validation.

### mattpocock/skills — https://github.com/mattpocock/skills

Copyright (c) 2026 Matt Pocock. MIT License.

Source of the interview method in step 3: the `grilling` skill's design tree,
rounds over the frontier of settled prerequisites, a recommended answer on
every question, and the split between facts (look them up) and decisions (ask
the user).

## MIT License

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
