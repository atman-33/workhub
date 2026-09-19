# Spec: <capability-id>

<!--
WHAT the system must do for this one capability — a behaviour contract, not an
implementation plan.

Belongs here: observable behaviour users or downstream systems rely on; inputs,
outputs and error conditions; external constraints (security, privacy,
reliability, compatibility); scenarios that can be tested.

Does not belong here: class or function names, library or framework choices,
step-by-step implementation. Quick test — if the implementation could change
without changing externally visible behaviour, it goes in design.md instead.

Format rules:
- Each requirement is `### Requirement: <name>` followed by its statement.
- State requirements normatively: SHALL / MUST (in Japanese: 〜しなければならない
  / 〜する). Avoid should / may.
- Every requirement has at least one `#### Scenario:` (exactly four #), written
  as WHEN / THEN bullets. Each scenario is a candidate test case.
- For a modified capability, use `## MODIFIED Requirements` and write each
  changed requirement out in full (not just the delta), and
  `## REMOVED Requirements` with a **Reason** and a **Migration** for anything
  dropped. Delete the sections you do not use.
-->

## Purpose

<!-- New capabilities only: one or two sentences on what this capability is for. -->

## ADDED Requirements

### Requirement: <requirement name>

<requirement statement>

#### Scenario: <scenario name>

- **WHEN** <condition>
- **THEN** <expected outcome>

## MODIFIED Requirements

## REMOVED Requirements
