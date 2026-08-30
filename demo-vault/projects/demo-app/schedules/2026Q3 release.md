---
type: schedule
title: 2026Q3 release
range: 2026-07-06..2026-10-16
sprint_start: 2026-07-06
sprint_weeks: 2
created: 2026-07-06
updated: 2026-08-29
---

## Non-working

- weekly: sat, sun
- 2026-08-11 Mountain Day
- 2026-08-13..2026-08-15 summer leave
- 2026-09-21 Respect for the Aged Day

## Items

- [bar] I-001 2026-07-06..2026-07-31 M1 capture and list #green
- [bar] I-002 2026-08-04..2026-08-28 M2 search #blue task:T-0003
- [arrow] I-003 2026-08-24..2026-09-11 CI stabilization #gray task:T-0004
  the flaky upload test is the only known blocker
- [bar] I-004 2026-09-01..2026-09-18 M3 stabilize #blue
- [arrow] I-005 2026-09-07..2026-09-25 API client migration #purple task:T-0006
  plan-first; the error mapping touches a dozen call sites
- [bar] I-006 2026-09-21..2026-10-09 M4 1.0 polish #amber
- [milestone] I-007 2026-08-31 M2 review #red
- [milestone] I-008 2026-10-10 1.0 release #red
- [note] I-009 2026-09-18 go / no-go
  30 min, with the whole team

## Memo

Free-form notes. Neither the app nor the AI rewrites anything from here down.

The September dates assume the CI work lands first — if it slips, M3 and the
API migration both move with it.
