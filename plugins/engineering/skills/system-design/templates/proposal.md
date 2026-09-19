# Proposal: <change title>

<!--
WHY and WHAT, not how. One to two pages. Everything else in the set builds on
this file, so write it first.
-->

## Why

<!-- One or two sentences: the problem or opportunity, and why now. -->

## What Changes

<!--
Bullets. Be specific about new capabilities, modifications and removals.
Mark a change that breaks existing users, data or APIs with **BREAKING**.
-->

## Capabilities

<!--
The contract with the spec files: each capability listed here gets exactly one
`spec-<capability>.md`, named with the same kebab-case id. A capability is a
unit of observable behaviour ("user-auth", "csv-export"), not a module.

If the target repository already documents its behaviour (existing specs,
design docs), reuse its capability names instead of inventing near-duplicates.

List a capability under "Modified" only when its observable behaviour changes,
not when only its implementation does. A change with no behaviour change at all
(pure refactor, tooling) lists none and writes no spec files — say so here.
-->

### New Capabilities

- `<capability-id>`: <what this capability covers>

### Modified Capabilities

- `<capability-id>`: <which behaviour changes>

## Impact

<!-- Affected code areas, APIs, data, dependencies, other systems, users. -->
