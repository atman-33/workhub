---
name: investigate-bug-report
description: Investigate a reported bug to its root cause — reproduce, trace the code path, identify the defect with evidence, assess blast radius, and propose fix candidates without changing code. Use when the user reports or pastes a bug/defect/unexpected behavior and wants it diagnosed, or asks "why is X happening".
allowed-tools: Read Glob Grep Bash
---

# Investigate Bug Report

Diagnose, don't fix. The deliverable is a root-cause finding with evidence —
apply a fix only if the user then asks.

## Steps

1. **Pin down the report.** Extract from the report (ask only for what's
   missing and blocking): observed behavior, expected behavior, steps or
   input that trigger it, environment/version if relevant.
   - Completion criterion: you can state "given X, it does Y, but should do Z"
     in one sentence.

2. **Reproduce — or trace when you can't.** Prefer an actual reproduction
   (run the failing command, a minimal script, or an existing test tightened
   to the case). When reproduction isn't feasible (needs external services,
   prod-only data), trace the code path statically from the entry point the
   report implies, and say the diagnosis is trace-based.
   - Completion criterion: the failure is observed firsthand, or the full
     path from trigger to symptom is traced with `file:line` hops.

3. **Isolate the root cause.** Follow the data from symptom back to the first
   point where state or logic diverges from intent. Distinguish the **root
   cause** from where the error surfaces — they are usually different lines.
   Check `git log`/`git blame` on the suspect code: a recent change that
   introduced it is strong corroborating evidence.
   - Completion criterion: one specific location (`file:line`) and mechanism
     explains every symptom in the report. A cause that explains only some
     symptoms is a co-incident finding, not the root cause — keep digging or
     report the gap explicitly.

4. **Assess blast radius.** Find other callers/inputs that hit the same
   defect (Grep for the pattern, referencing symbols). Note data that may
   already be corrupted if the bug writes state.
   - Completion criterion: every caller of the defective code is classified
     affected / unaffected.

5. **Propose fix candidates.** 1–3 options with tradeoffs (minimal patch vs.
   proper restructure), the recommended one first, plus the regression test
   that would have caught this.

6. **Report.** Deliver: the one-sentence problem statement, root cause with
   evidence (`file:line`, repro output or trace), blast radius, fix
   candidates. Flag anything unverified as such. Stop — do not edit code
   unless the user asks.

## Failure modes

- Cannot reproduce and the trace shows the code behaving as specified →
  report that finding with the evidence; a "works as designed" or
  "environment-specific" conclusion is a valid outcome, not a failure.
- Multiple independent defects surface → report each separately; don't merge
  them into one narrative.
- Trail runs into code you can't see (external service, binary dependency) →
  report the boundary you traced to and what instrumentation would confirm it.
